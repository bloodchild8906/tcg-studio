/**
 * Project routes (sec 16).
 *
 * All routes here are inside the tenant scope — `request.tenantContext` is
 * guaranteed to be set, and every Prisma call filters by `tenantId` to keep
 * tenant isolation airtight.
 *
 * Endpoints:
 *   GET    /api/v1/projects            list projects in this tenant
 *   POST   /api/v1/projects            create a project
 *   GET    /api/v1/projects/:id        fetch one
 *   PATCH  /api/v1/projects/:id        partial update
 *   DELETE /api/v1/projects/:id        delete (cascades to card types, cards, etc.)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { enforceLimit } from "@/lib/plans";
import {
  assertProjectAccess,
  ProjectAccessError,
  visibleProjectIds,
} from "@/lib/projectAccess";

const projectIdParam = z.object({ id: z.string().min(1) });

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
  description: z.string().max(2000).optional(),
  status: z
    .enum(["idea", "draft", "prototype", "playtesting", "production", "released", "archived"])
    .optional(),
  version: z.string().max(40).optional(),
  /// Email of the user who becomes this project's first owner. The
  /// tenant admin who creates the project does NOT automatically get
  /// access to it — they must specify a login (a real user email) that
  /// will sign in to manage the project. The user must already be a
  /// tenant member; magic-link invites land later. This separation
  /// keeps platform / tenant / project credentials distinct, per the
  /// product policy that "tenants cannot log into projects unless
  /// added as a user".
  ownerEmail: z.string().email(),
  /// Optional white-label tokens captured by the project-creation
  /// wizard (productName, tagline, accent). Stored as the project's
  /// brandingJson and read by the auto-seeded CMS landing page so
  /// the project's first public hero reflects the user's brand.
  brandingJson: z.record(z.string(), z.unknown()).optional(),
  /// Commerce — pricing, currency, royalty splits, payout account.
  /// Empty = project doesn't sell anything.
  economyJson: z.record(z.string(), z.unknown()).optional(),
  /// SEO defaults, social handles, newsletter integration.
  marketingJson: z.record(z.string(), z.unknown()).optional(),
  /// Public storefront toggles and commerce policies.
  storefrontJson: z.record(z.string(), z.unknown()).optional(),
  /// Per-project email provider config.
  emailSettingsJson: z.record(z.string(), z.unknown()).optional(),
  /// Per-project storage backend.
  storageSettingsJson: z.record(z.string(), z.unknown()).optional(),
});

const patchBody = createBody.partial();

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/projects", async (request) => {
    const { tenantId } = requireTenant(request);
    // Filter the list to projects the caller actually has access to (sec
    // 13.4). Bypass roles see everything; everyone else sees only the
    // projects they're an explicit member of. API-key callers also see
    // everything because the key already encodes its tenant scope.
    const userId = request.currentUser?.id;
    const isApiKey = Boolean(request.apiKey);
    const visible = isApiKey
      ? ({ all: true } as const)
      : await visibleProjectIds(fastify.prisma, tenantId, userId);
    const projects = await fastify.prisma.project.findMany({
      where:
        visible.all === true
          ? { tenantId }
          : { tenantId, id: { in: Array.from(visible.ids) } },
      orderBy: { updatedAt: "desc" },
    });
    return { projects };
  });

  fastify.post("/api/v1/projects", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    // Plan-tier check — count existing projects, then enforce. We
    // run the count + enforce sequence rather than a single SQL
    // CHECK because limits live on the plan row's JSON blob, not in
    // a column; cheaper and more flexible to do it in app code.
    const currentCount = await fastify.prisma.project.count({
      where: { tenantId },
    });
    await enforceLimit(fastify.prisma, tenantId, "projects", currentCount);

    // Resolve the owner email FIRST — fail fast if the specified user
    // doesn't exist or isn't a tenant member, before creating the
    // project. Otherwise we'd leave a project with no members on a
    // partial failure, and the creator wouldn't be able to recover
    // because they don't auto-get access either.
    const ownerUser = await fastify.prisma.user.findUnique({
      where: { email: body.ownerEmail.toLowerCase() },
      select: { id: true, email: true, name: true },
    });
    if (!ownerUser) {
      return reply.code(404).send({
        error: "owner_not_found",
        message:
          "No user with that email exists yet. Ask them to sign up first, then create the project with their email as the owner.",
      });
    }
    const ownerTenantMember = await fastify.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: ownerUser.id } },
      select: { id: true },
    });
    if (!ownerTenantMember) {
      return reply.code(409).send({
        error: "owner_not_tenant_member",
        message:
          "Project owner must be a member of this tenant first. Add them at the tenant level, then create the project.",
      });
    }

    const project = await fastify.prisma.project.create({
      data: {
        tenantId,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        status: body.status ?? "draft",
        version: body.version ?? "v0.1",
        ...(body.brandingJson
          ? { brandingJson: body.brandingJson as object }
          : {}),
      },
    });

    // Grant the SPECIFIED owner — not the creator — a project_owner
    // membership. This enforces the policy that "tenants cannot log
    // into projects unless added as a user". A tenant admin who
    // creates a project under their account but specifies a different
    // email as the project owner will NOT themselves have access to
    // the project. They must either set themselves as the owner here,
    // or be invited later by the owner. There is no tenant-role
    // bypass for project access.
    await fastify.prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: ownerUser.id,
        role: "project_owner",
      },
    });

    // Seed the project's public site with default home + login pages
    // (sec 14). Same pattern as tenant create: every CMS surface gets
    // landing + auth out of the box, with the project's branding (when
    // captured by the wizard) baked into the hero. Non-fatal — a
    // missing public site can be backfilled via the manual seed.
    try {
      const { ensureDefaultCmsContent } = await import("@/lib/cmsDefaults");
      const branding = (project.brandingJson ?? {}) as {
        productName?: string;
        tagline?: string;
      };
      await ensureDefaultCmsContent(fastify.prisma, tenantId, {
        siteName: project.name,
        productName: branding.productName ?? project.name,
        tagline: branding.tagline,
        projectId: project.id,
        projectSlug: project.slug,
      });
    } catch (err) {
      request.log.warn(
        { err, projectId: project.id },
        "ensureDefaultCmsContent failed at project create",
      );
    }

    return reply.code(201).send({ project });
  });

  fastify.get("/api/v1/projects/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = projectIdParam.parse(request.params);
    try {
      await assertProjectAccess({
        prisma: fastify.prisma,
        request,
        tenantId,
        projectId: id,
      });
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return reply.code(403).send({ error: "forbidden", message: err.message });
      }
      throw err;
    }
    const project = await fastify.prisma.project.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { project };
  });

  fastify.patch("/api/v1/projects/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = projectIdParam.parse(request.params);
    const body = patchBody.parse(request.body);
    try {
      await assertProjectAccess({
        prisma: fastify.prisma,
        request,
        tenantId,
        projectId: id,
      });
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return reply.code(403).send({ error: "forbidden", message: err.message });
      }
      throw err;
    }

    // Cherry-pick allowed columns. `body` may carry `ownerEmail`
    // (a create-only field) which isn't a Project column — passing
    // it raw to Prisma would either be ignored or error depending
    // on Prisma's validation mode. Be explicit.
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.status !== undefined) data.status = body.status;
    if (body.version !== undefined) data.version = body.version;
    if (body.brandingJson !== undefined) data.brandingJson = body.brandingJson as object;
    if (body.economyJson !== undefined) data.economyJson = body.economyJson as object;
    if (body.marketingJson !== undefined) data.marketingJson = body.marketingJson as object;
    if (body.storefrontJson !== undefined) data.storefrontJson = body.storefrontJson as object;
    if (body.emailSettingsJson !== undefined) data.emailSettingsJson = body.emailSettingsJson as object;
    if (body.storageSettingsJson !== undefined) data.storageSettingsJson = body.storageSettingsJson as object;

    // updateMany so the WHERE clause filters by tenant — `update` would only
    // filter by the unique id and could touch another tenant's row.
    const result = await fastify.prisma.project.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) {
      return { error: "not_found" };
    }
    const project = await fastify.prisma.project.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { project };
  });

  // Project-level branding (sec 11.4 — per-level theme). Lets project
  // admins skin their project independently of the tenant theme.
  // Returns null when the project hasn't customized — the renderer
  // falls back to the tenant theme.
  fastify.get("/api/v1/projects/:id/branding", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = projectIdParam.parse(request.params);
    try {
      await assertProjectAccess({
        prisma: fastify.prisma,
        request,
        tenantId,
        projectId: id,
      });
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return reply.code(403).send({ error: "forbidden" });
      }
      throw err;
    }
    const p = await fastify.prisma.project.findFirst({
      where: { id, tenantId },
      select: { brandingJson: true },
    });
    if (!p) return reply.code(404).send({ error: "not_found" });
    return { branding: p.brandingJson ?? {} };
  });

  fastify.put("/api/v1/projects/:id/branding", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = projectIdParam.parse(request.params);
    const body = z
      .object({ branding: z.record(z.unknown()) })
      .parse(request.body);
    try {
      await assertProjectAccess({
        prisma: fastify.prisma,
        request,
        tenantId,
        projectId: id,
      });
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return reply.code(403).send({ error: "forbidden" });
      }
      throw err;
    }
    const result = await fastify.prisma.project.updateMany({
      where: { id, tenantId },
      data: { brandingJson: body.branding as object },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return { branding: body.branding };
  });

  fastify.delete("/api/v1/projects/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = projectIdParam.parse(request.params);
    try {
      await assertProjectAccess({
        prisma: fastify.prisma,
        request,
        tenantId,
        projectId: id,
      });
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return reply.code(403).send({ error: "forbidden", message: err.message });
      }
      throw err;
    }
    const result = await fastify.prisma.project.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.code(204).send();
  });
}
