/**
 * Plan catalog + tenant subscription routes (sec 42).
 *
 *   GET   /api/v1/plans               public catalog (auth-free? no — tenant-scoped)
 *   GET   /api/v1/billing             current tenant's plan + live usage counts
 *   POST  /api/v1/billing/subscribe   switch the tenant to a plan slug
 *
 * Real billing (Stripe/Paddle/etc) is out of scope for v0; the
 * subscribe endpoint just flips `Tenant.planId` after recording an
 * audit row. The platform owner can wire a payment processor later
 * by intercepting this route.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";

const subscribeBody = z.object({
  planSlug: z.string().min(1).max(40),
});

export default async function planRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/plans", async () => {
    const plans = await fastify.prisma.plan.findMany({
      where: { status: "active" },
      orderBy: { sortOrder: "asc" },
    });
    return { plans };
  });

  fastify.get("/api/v1/billing", async (request) => {
    const { tenantId } = requireTenant(request);
    const tenant = await fastify.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true },
    });

    // Live usage counters — what the tenant is consuming right now.
    // We query each in parallel; the storage figure sums Asset.fileSize
    // because that's the source of truth for what's in MinIO. Counts
    // here are upper bounds — soft caches can lag by seconds — which
    // is fine for a usage display (the enforcement helper queries
    // fresh on every create attempt).
    const [
      projectCount,
      memberCount,
      apiKeyCount,
      webhookCount,
      pluginCount,
      domainCount,
      assetSum,
    ] = await Promise.all([
      fastify.prisma.project.count({ where: { tenantId } }),
      fastify.prisma.membership.count({ where: { tenantId } }),
      fastify.prisma.apiKey.count({
        where: { tenantId, revokedAt: null },
      }),
      fastify.prisma.webhook.count({ where: { tenantId } }),
      fastify.prisma.pluginInstall.count({ where: { tenantId } }),
      fastify.prisma.tenantDomain.count({ where: { tenantId } }),
      fastify.prisma.asset.aggregate({
        where: { tenantId },
        _sum: { fileSize: true },
      }),
    ]);

    const usage = {
      projects: projectCount,
      members: memberCount,
      apiKeys: apiKeyCount,
      webhooks: webhookCount,
      plugins: pluginCount,
      customDomains: domainCount,
      storageMiB: Math.round((assetSum._sum.fileSize ?? 0) / (1024 * 1024)),
    };

    return {
      plan: tenant.plan ?? null,
      planSince: tenant.planSince,
      usage,
    };
  });

  fastify.post("/api/v1/billing/subscribe", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const body = subscribeBody.parse(request.body);

    const plan = await fastify.prisma.plan.findUnique({
      where: { slug: body.planSlug },
    });
    if (!plan || plan.status !== "active") {
      return reply.code(404).send({ error: "plan_not_found" });
    }

    const before = await fastify.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { planId: true },
    });

    await fastify.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        planId: plan.id,
        planSince: new Date(),
      },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "billing.subscribe",
      actorUserId: user.id,
      entityType: "plan",
      entityId: plan.id,
      metadata: {
        from: before.planId ?? null,
        to: plan.slug,
      },
    });

    return reply.send({ ok: true, planSlug: plan.slug });
  });
}
