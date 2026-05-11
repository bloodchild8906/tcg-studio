/**
 * Tenant routes — registered OUTSIDE the tenant scope.
 *
 * Tenants are the multi-tenant boundary, so the routes that manage them
 * cannot themselves require tenant context (chicken / egg). They sit
 * alongside `/healthz` at the top level.
 *
 * In a real deployment these would be platform-admin only (sec 13.2). For v0
 * they're open — same trust posture as the rest of the API.
 *
 * Endpoints:
 *   GET    /api/v1/tenants            list every tenant
 *   POST   /api/v1/tenants            create
 *   GET    /api/v1/tenants/:id        fetch one
 *   PATCH  /api/v1/tenants/:id        partial update (name, slug, status)
 *   DELETE /api/v1/tenants/:id        delete (cascades to all owned data)
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const idParam = z.object({ id: z.string().min(1) });

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: "slug must be lowercase, hyphen-separated, no leading/trailing hyphens",
  });

const createBody = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
  status: z
    .enum(["trial", "active", "past_due", "suspended", "disabled", "pending_deletion"])
    .optional(),
  brandingJson: z.record(z.string(), z.unknown()).optional(),
  tenantType: z
    .enum(["solo", "studio", "publisher", "school", "reseller"])
    .optional(),
  defaultLocale: z.string().min(2).max(10).optional(),
  supportedLocalesJson: z.array(z.string().min(2).max(10)).optional(),
  /// Per-tenant email provider config — see Tenant.emailSettingsJson.
  emailSettingsJson: z.record(z.string(), z.unknown()).optional(),
  /// Per-tenant storage provider config — see Tenant.storageSettingsJson.
  storageSettingsJson: z.record(z.string(), z.unknown()).optional(),
});

const patchBody = createBody.partial();

const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  brandingJson: true,
  tenantType: true,
  defaultLocale: true,
  supportedLocalesJson: true,
  emailSettingsJson: true,
  storageSettingsJson: true,
  createdAt: true,
  updatedAt: true,
} as const;

export default async function tenantRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/tenants", async () => {
    const tenants = await fastify.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      select: TENANT_SELECT,
    });
    return { tenants };
  });

  fastify.post("/api/v1/tenants", async (request, reply) => {
    const body = createBody.parse(request.body);
    const tenant = await fastify.prisma.tenant.create({
      data: {
        name: body.name,
        slug: body.slug,
        status: body.status ?? "active",
        brandingJson: (body.brandingJson ?? {}) as unknown as Prisma.InputJsonValue,
        ...(body.tenantType ? { tenantType: body.tenantType } : {}),
      },
      select: TENANT_SELECT,
    });

    // Every new tenant ships with a default public site + landing
    // page + auth pages so the public surface is on from day one.
    // The seeded landing pulls productName / tagline out of the
    // brandingJson (populated by the registration wizard) so the
    // first render reflects the user's actual brand instead of a
    // generic "Welcome." placeholder.
    try {
      const { ensureDefaultCmsContent } = await import("@/lib/cmsDefaults");
      const branding = (tenant.brandingJson ?? {}) as {
        productName?: string;
        tagline?: string;
      };
      await ensureDefaultCmsContent(fastify.prisma, tenant.id, {
        siteName: tenant.name,
        productName: branding.productName ?? tenant.name,
        tagline: branding.tagline,
      });
    } catch (err) {
      // Non-fatal — the tenant exists, the user can backfill via
      // the manual seed endpoint if this errors.
      request.log.warn(
        { err, tenantId: tenant.id },
        "ensureDefaultCmsContent failed at tenant create",
      );
    }

    return reply.code(201).send({ tenant });
  });

  fastify.get("/api/v1/tenants/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const tenant = await fastify.prisma.tenant.findFirstOrThrow({
      where: { id },
      select: TENANT_SELECT,
    });
    return { tenant };
  });

  fastify.patch("/api/v1/tenants/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);
    const data: Prisma.TenantUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.status !== undefined) data.status = body.status;
    if (body.brandingJson !== undefined) {
      data.brandingJson = body.brandingJson as unknown as Prisma.InputJsonValue;
    }
    if (body.tenantType !== undefined) data.tenantType = body.tenantType;
    if (body.defaultLocale !== undefined) data.defaultLocale = body.defaultLocale;
    if (body.supportedLocalesJson !== undefined) {
      // Force the default into the supported list — keeps the
      // invariant the public renderer relies on without a separate
      // `defaultIsSupported` constraint at the DB.
      const def = body.defaultLocale ?? data.defaultLocale;
      const list = body.supportedLocalesJson;
      const final =
        typeof def === "string" && !list.includes(def) ? [def, ...list] : list;
      data.supportedLocalesJson = final as unknown as Prisma.InputJsonValue;
    }
    if (body.emailSettingsJson !== undefined) {
      data.emailSettingsJson = body.emailSettingsJson as unknown as Prisma.InputJsonValue;
    }
    if (body.storageSettingsJson !== undefined) {
      data.storageSettingsJson = body.storageSettingsJson as unknown as Prisma.InputJsonValue;
    }
    const result = await fastify.prisma.tenant.updateMany({
      where: { id },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const tenant = await fastify.prisma.tenant.findFirstOrThrow({
      where: { id },
      select: TENANT_SELECT,
    });
    return { tenant };
  });

  fastify.delete("/api/v1/tenants/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    // Prisma onDelete: Cascade on all child relations means this nukes
    // every project / card type / card / asset / membership for the tenant.
    const result = await fastify.prisma.tenant.deleteMany({ where: { id } });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // Keep the Prisma import live for forward editing.
  void Prisma;
}
