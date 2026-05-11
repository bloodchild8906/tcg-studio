/**
 * Webhook subscription routes (sec 36).
 *
 *   GET    /api/v1/webhooks                list
 *   POST   /api/v1/webhooks                create — secret returned ONCE
 *   PATCH  /api/v1/webhooks/:id            update target / events / enabled
 *   DELETE /api/v1/webhooks/:id            delete (cascades deliveries)
 *   GET    /api/v1/webhooks/:id/deliveries recent delivery results
 *   POST   /api/v1/webhooks/:id/test       send a synthetic ping event
 *
 * Audit: create / update (enabled flip) / delete each write a row.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";

const idParam = z.object({ id: z.string().min(1) });

const createBody = z.object({
  name: z.string().min(1).max(120),
  targetUrl: z.string().url().max(2000),
  events: z.array(z.string().min(1).max(80)).min(1).max(40),
});

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  targetUrl: z.string().url().max(2000).optional(),
  events: z.array(z.string().min(1).max(80)).min(1).max(40).optional(),
  enabled: z.boolean().optional(),
  failureBackoff: z.number().int().min(0).max(1000).optional(),
});

export default async function webhookRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/webhooks", async (request) => {
    const { tenantId } = requireTenant(request);
    const hooks = await fastify.prisma.webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      // Never return secret in the list — it's plaintext-once.
      select: {
        id: true,
        name: true,
        targetUrl: true,
        events: true,
        enabled: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        failureBackoff: true,
        consecutiveFailures: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { webhooks: hooks };
  });

  fastify.post("/api/v1/webhooks", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const body = createBody.parse(request.body);

    const secret = crypto.randomBytes(32).toString("hex");
    const hook = await fastify.prisma.webhook.create({
      data: {
        tenantId,
        name: body.name,
        targetUrl: body.targetUrl,
        secret,
        events: body.events as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        name: true,
        targetUrl: true,
        events: true,
        enabled: true,
        createdAt: true,
      },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "webhook.create",
      actorUserId: user.id,
      entityType: "webhook",
      entityId: hook.id,
      metadata: { name: body.name, events: body.events },
    });

    // Secret is shown ONCE. Same shape as the API key flow.
    return reply.code(201).send({ webhook: hook, secret });
  });

  fastify.patch("/api/v1/webhooks/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.WebhookUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.targetUrl !== undefined) data.targetUrl = body.targetUrl;
    if (body.events !== undefined) {
      data.events = body.events as unknown as Prisma.InputJsonValue;
    }
    if (body.enabled !== undefined) {
      data.enabled = body.enabled;
      // Re-enabling resets the failure counter so we don't disable
      // again immediately on the first failed retry.
      if (body.enabled) data.consecutiveFailures = 0;
    }
    if (body.failureBackoff !== undefined)
      data.failureBackoff = body.failureBackoff;

    const result = await fastify.prisma.webhook.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });

    const webhook = await fastify.prisma.webhook.findFirstOrThrow({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        targetUrl: true,
        events: true,
        enabled: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        failureBackoff: true,
        consecutiveFailures: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "webhook.update",
      actorUserId: user.id,
      entityType: "webhook",
      entityId: id,
    });

    return { webhook };
  });

  fastify.delete("/api/v1/webhooks/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const result = await fastify.prisma.webhook.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "webhook.delete",
      actorUserId: user.id,
      entityType: "webhook",
      entityId: id,
    });

    return reply.code(204).send();
  });

  fastify.get("/api/v1/webhooks/:id/deliveries", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const hook = await fastify.prisma.webhook.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!hook) return reply.code(404).send({ error: "not_found" });
    const deliveries = await fastify.prisma.webhookDelivery.findMany({
      where: { webhookId: hook.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { deliveries };
  });

  fastify.post("/api/v1/webhooks/:id/test", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const hook = await fastify.prisma.webhook.findFirst({
      where: { id, tenantId, enabled: true },
    });
    if (!hook) return reply.code(404).send({ error: "not_found_or_disabled" });

    // Synthetic ping. Receivers can use this to verify their HMAC
    // implementation without waiting for a real event to fire.
    await dispatchWebhook(fastify.prisma, request.log, {
      tenantId,
      event: "webhook.test",
      data: {
        message: "This is a test event from your TCGStudio tenant.",
        webhookId: hook.id,
      },
    });
    return reply.send({ ok: true });
  });
}
