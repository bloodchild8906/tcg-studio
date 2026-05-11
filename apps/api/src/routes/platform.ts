/**
 * Platform-admin API (sec 9.2).
 *
 * Cross-tenant management surfaces gated by `User.platformRole`.
 * Lives outside the tenant-scoped block so the platform owner can
 * see every workspace, every plan, every announcement — not just
 * the tenants they happen to be a member of.
 *
 * Endpoints:
 *
 *   GET  /api/v1/platform/me             — quick role probe; the
 *                                          frontend uses this to
 *                                          decide whether to expose
 *                                          the platform sidebar.
 *
 *   GET  /api/v1/platform/tenants        — directory: every tenant,
 *                                          status, plan, member count,
 *                                          project count.
 *
 *   PATCH /api/v1/platform/tenants/:id   — change status (suspend /
 *                                          reactivate / disable).
 *
 *   GET  /api/v1/platform/billing/summary
 *                                        — roll-up: plan distribution,
 *                                          revenue snapshot, usage
 *                                          highlights.
 *
 *   GET    /api/v1/platform/announcements
 *   POST   /api/v1/platform/announcements
 *   PATCH  /api/v1/platform/announcements/:id
 *   DELETE /api/v1/platform/announcements/:id
 *                                        — marketing banner CRUD.
 *
 *   GET  /api/v1/platform/announcements/active
 *                                        — public, no auth needed.
 *                                          The tenant admin shell
 *                                          calls this on boot to
 *                                          render the banner strip.
 *
 * Permission ladder: any non-null `platformRole` can read; only
 * `owner` and `admin` can mutate. `support` is read-only on
 * purpose so support reps can investigate without changing data.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";

const idParam = z.object({ id: z.string().min(1) });

const tenantPatchBody = z.object({
  status: z
    .enum([
      "trial",
      "active",
      "past_due",
      "suspended",
      "disabled",
      "pending_deletion",
    ])
    .optional(),
});

const announcementBody = z.object({
  kind: z.enum(["info", "warning", "maintenance", "marketing"]).default("info"),
  headline: z.string().min(1).max(200),
  body: z.string().max(4000).default(""),
  ctaLabel: z.string().max(80).nullable().optional(),
  ctaUrl: z.string().max(2000).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});

/** Requires a non-null platformRole. Throws 403 otherwise.
 *  Returns the role string so callers can branch on owner vs support. */
async function requirePlatformRole(
  fastify: FastifyInstance,
  request: FastifyRequest,
  minRole: "support" | "admin" | "owner" = "support",
): Promise<string> {
  const u = requireUser(request);
  const row = await fastify.prisma.user.findUnique({
    where: { id: u.id },
    select: { platformRole: true },
  });
  const role = row?.platformRole ?? null;
  if (!role) {
    throw Object.assign(new Error("not a platform admin"), { statusCode: 403 });
  }
  // owner > admin > support — string compare is good enough since the
  // ladder has only three rungs.
  const ladder = ["support", "admin", "owner"];
  if (ladder.indexOf(role) < ladder.indexOf(minRole)) {
    throw Object.assign(new Error("insufficient platform role"), {
      statusCode: 403,
    });
  }
  return role;
}

export default async function platformRoutes(fastify: FastifyInstance) {
  /** Role probe — used by the frontend to decide whether to render
   *  the platform sidebar entries. Always returns a 200 with `null`
   *  role for non-admins so the frontend doesn't have to disambiguate
   *  401 from "not a platform admin". */
  fastify.get("/api/v1/platform/me", async (request) => {
    let userId: string | null = null;
    try {
      userId = requireUser(request).id;
    } catch {
      return { role: null };
    }
    const row = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true },
    });
    return { role: row?.platformRole ?? null };
  });

  // -------------------------------------------------------------------------
  // Tenants directory
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/platform/tenants", async (request) => {
    await requirePlatformRole(fastify, request, "support");

    // The platform's internal tenant (PLATFORM_TENANT_SLUG, default
    // "platform") is the namespace for the marketing CMS, marketplace,
    // and support inbox — it isn't a user-facing workspace, so it has
    // no place in the tenant directory the operator sees. Filter it
    // out by slug so they only see customer tenants they actually
    // manage and bill.
    const { loadEnv } = await import("@/env");
    const env = loadEnv();

    // Platform admin only sees tenants — not projects. Projects are an
    // internal concept of each tenant; the platform layer never reads
    // them. Counts are limited to memberships so platform admins can
    // gauge tenant size without leaking project metadata across the
    // tenant boundary.
    const tenants = await fastify.prisma.tenant.findMany({
      where: { slug: { not: env.PLATFORM_TENANT_SLUG } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        plan: { select: { slug: true, name: true, priceCents: true } },
        _count: {
          select: { memberships: true },
        },
      },
    });
    return { tenants };
  });

  fastify.patch("/api/v1/platform/tenants/:id", async (request, reply) => {
    await requirePlatformRole(fastify, request, "admin");
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = tenantPatchBody.parse(request.body);

    if (!body.status) return reply.code(400).send({ error: "no_changes" });

    const updated = await fastify.prisma.tenant.update({
      where: { id },
      data: { status: body.status },
    });

    // Cross-tenant audit — the row is filed against the tenant being
    // touched so the affected tenant's audit log shows the change.
    await writeAudit(fastify.prisma, request, {
      tenantId: updated.id,
      action: "platform.tenant.status",
      actorUserId: user.id,
      entityType: "tenant",
      entityId: updated.id,
      metadata: { status: updated.status },
    });

    return { tenant: updated };
  });

  // -------------------------------------------------------------------------
  // Billing roll-up
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/platform/billing/summary", async (request) => {
    await requirePlatformRole(fastify, request, "support");

    // Exclude the platform's internal tenant from the roll-up — it isn't
    // a paying customer, just the namespace for the marketing CMS. See
    // the rationale on /api/v1/platform/tenants above.
    const { loadEnv } = await import("@/env");
    const env = loadEnv();

    const tenants = await fastify.prisma.tenant.findMany({
      where: { slug: { not: env.PLATFORM_TENANT_SLUG } },
      select: {
        id: true,
        status: true,
        plan: { select: { slug: true, priceCents: true, billingPeriod: true } },
      },
    });
    const totalTenants = tenants.length;
    const activeTenants = tenants.filter(
      (t) => t.status === "active" || t.status === "trial",
    ).length;
    const planDistribution = new Map<string, number>();
    let monthlyRecurringCents = 0;
    for (const t of tenants) {
      const slug = t.plan?.slug ?? "(unassigned)";
      planDistribution.set(slug, (planDistribution.get(slug) ?? 0) + 1);
      if (
        t.status !== "active" &&
        t.status !== "trial" &&
        t.status !== "past_due"
      ) {
        continue;
      }
      const price = t.plan?.priceCents ?? 0;
      const period = t.plan?.billingPeriod ?? "free";
      if (period === "monthly") monthlyRecurringCents += price;
      else if (period === "yearly") monthlyRecurringCents += Math.round(price / 12);
    }

    return {
      totalTenants,
      activeTenants,
      planDistribution: Array.from(planDistribution.entries()).map(
        ([slug, count]) => ({ slug, count }),
      ),
      monthlyRecurringCents,
    };
  });

  // -------------------------------------------------------------------------
  // Announcements
  // -------------------------------------------------------------------------

  /** Public — no auth gate. The tenant shell calls this on boot to
   *  paint the banner strip. Returns only `active` rows whose window
   *  is currently open. */
  fastify.get("/api/v1/platform/announcements/active", async () => {
    const now = new Date();
    const rows = await fastify.prisma.platformAnnouncement.findMany({
      where: {
        status: "active",
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return { announcements: rows };
  });

  fastify.get("/api/v1/platform/announcements", async (request) => {
    await requirePlatformRole(fastify, request, "support");
    const rows = await fastify.prisma.platformAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { announcements: rows };
  });

  fastify.post("/api/v1/platform/announcements", async (request, reply) => {
    await requirePlatformRole(fastify, request, "admin");
    const user = requireUser(request);
    const body = announcementBody.parse(request.body);

    const row = await fastify.prisma.platformAnnouncement.create({
      data: {
        kind: body.kind,
        headline: body.headline,
        body: body.body,
        ctaLabel: body.ctaLabel ?? null,
        ctaUrl: body.ctaUrl ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        status: body.status,
        createdBy: user.id,
      },
    });
    return reply.code(201).send({ announcement: row });
  });

  fastify.patch(
    "/api/v1/platform/announcements/:id",
    async (request, reply) => {
      await requirePlatformRole(fastify, request, "admin");
      const { id } = idParam.parse(request.params);
      const body = announcementBody.partial().parse(request.body);

      const data: Prisma.PlatformAnnouncementUpdateInput = {};
      if (body.kind !== undefined) data.kind = body.kind;
      if (body.headline !== undefined) data.headline = body.headline;
      if (body.body !== undefined) data.body = body.body;
      if (body.ctaLabel !== undefined) data.ctaLabel = body.ctaLabel ?? null;
      if (body.ctaUrl !== undefined) data.ctaUrl = body.ctaUrl ?? null;
      if (body.startsAt !== undefined)
        data.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.endsAt !== undefined)
        data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.status !== undefined) data.status = body.status;

      const result = await fastify.prisma.platformAnnouncement.updateMany({
        where: { id },
        data,
      });
      if (result.count === 0) return reply.code(404).send({ error: "not_found" });
      const row = await fastify.prisma.platformAnnouncement.findFirstOrThrow({
        where: { id },
      });
      return { announcement: row };
    },
  );

  fastify.delete(
    "/api/v1/platform/announcements/:id",
    async (request, reply) => {
      await requirePlatformRole(fastify, request, "admin");
      const { id } = idParam.parse(request.params);
      const result = await fastify.prisma.platformAnnouncement.deleteMany({
        where: { id },
      });
      if (result.count === 0) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // Platform admins directory (sec 13.2) — RBAC for super-admin access.
  // Each row is a User with a non-null `platformRole`. Owners can
  // promote/demote anyone; admins can promote to support but not
  // owner; support is read-only on this surface.
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/platform/admins", async (request) => {
    await requirePlatformRole(fastify, request, "support");
    const admins = await fastify.prisma.user.findMany({
      where: { platformRole: { not: null } },
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
      },
    });
    return { admins };
  });

  fastify.put("/api/v1/platform/admins", async (request, reply) => {
    // Promote an existing user (by email) to a platform role. Only
    // owner/admin can promote; admins can't promote to "owner".
    const callerRole = await requirePlatformRole(fastify, request, "admin");
    const caller = requireUser(request);
    const body = z
      .object({
        email: z.string().email(),
        role: z.enum(["owner", "admin", "support"]),
      })
      .parse(request.body);

    if (body.role === "owner" && callerRole !== "owner") {
      return reply.code(403).send({
        error: "owner_only",
        message: "Only platform owners can grant the owner role.",
      });
    }

    const emailLower = body.email.toLowerCase();
    const user = await fastify.prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true, email: true, name: true },
    });

    // No account yet — create a platform-scope Invitation. Redemption
    // at signup time will set User.platformRole.
    if (!user) {
      const existingInvite = await fastify.prisma.invitation.findFirst({
        where: { scope: "platform", email: emailLower, status: "pending" },
        select: { id: true },
      });
      if (existingInvite) {
        return reply.code(409).send({
          error: "invite_pending",
          message: `An invitation is already pending for ${emailLower}.`,
        });
      }
      const { default: crypto } = await import("node:crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const invite = await fastify.prisma.invitation.create({
        data: {
          scope: "platform",
          tenantId: null,
          projectId: null,
          email: emailLower,
          role: body.role,
          token,
          expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          invitedBy: caller.id,
        },
      });
      return reply.code(201).send({ invitation: invite, kind: "invitation" });
    }

    const updated = await fastify.prisma.user.update({
      where: { id: user.id },
      data: { platformRole: body.role },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
      },
    });

    // Cross-tenant audit lives on the actor's first available tenant
    // (audit rows require a tenantId). Pick any membership the caller
    // has — non-fatal if missing.
    const callerTenant = await fastify.prisma.membership.findFirst({
      where: { userId: caller.id },
      select: { tenantId: true },
    });
    if (callerTenant) {
      await writeAudit(fastify.prisma, request, {
        tenantId: callerTenant.tenantId,
        action: "platform.admin.grant",
        actorUserId: caller.id,
        entityType: "user",
        entityId: updated.id,
        metadata: { role: body.role, email: updated.email },
      });
    }

    return reply.send({ admin: updated });
  });

  fastify.delete("/api/v1/platform/admins/:id", async (request, reply) => {
    // Revoke a user's platform role. Only owner/admin can revoke;
    // admins can't revoke owners. Last-owner protection: refuse to
    // demote the only remaining owner.
    const callerRole = await requirePlatformRole(fastify, request, "admin");
    const caller = requireUser(request);
    const { id } = idParam.parse(request.params);

    const target = await fastify.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, platformRole: true },
    });
    if (!target?.platformRole) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (target.platformRole === "owner" && callerRole !== "owner") {
      return reply.code(403).send({
        error: "owner_only",
        message: "Only platform owners can revoke the owner role.",
      });
    }
    if (target.platformRole === "owner") {
      const ownerCount = await fastify.prisma.user.count({
        where: { platformRole: "owner" },
      });
      if (ownerCount <= 1) {
        return reply.code(409).send({
          error: "last_owner",
          message: "Can't revoke the last platform owner.",
        });
      }
    }

    await fastify.prisma.user.update({
      where: { id },
      data: { platformRole: null },
    });

    const callerTenant = await fastify.prisma.membership.findFirst({
      where: { userId: caller.id },
      select: { tenantId: true },
    });
    if (callerTenant) {
      await writeAudit(fastify.prisma, request, {
        tenantId: callerTenant.tenantId,
        action: "platform.admin.revoke",
        actorUserId: caller.id,
        entityType: "user",
        entityId: target.id,
        metadata: { previousRole: target.platformRole, email: target.email },
      });
    }

    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // Roles + permissions catalog (sec 13). Real RBAC: any number of
  // custom roles with permission lists, not a hardcoded enum. The
  // catalog endpoint returns the permission registry the picker UI
  // renders; the role endpoints CRUD the Role table.
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/platform/permissions", async (request) => {
    await requirePlatformRole(fastify, request, "support");
    const { PERMISSION_CATALOG } = await import("@/lib/permissions");
    return {
      permissions: PERMISSION_CATALOG.filter((p) => p.scope === "platform"),
    };
  });

  fastify.get("/api/v1/platform/roles", async (request) => {
    await requirePlatformRole(fastify, request, "support");
    const roles = await fastify.prisma.role.findMany({
      where: { scope: "platform" },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return { roles };
  });

  fastify.post("/api/v1/platform/roles", async (request, reply) => {
    await requirePlatformRole(fastify, request, "admin");
    const user = requireUser(request);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        slug: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/),
        description: z.string().max(400).optional(),
        permissions: z.array(z.string()).default([]),
      })
      .parse(request.body);

    const role = await fastify.prisma.role.create({
      data: {
        scope: "platform",
        tenantId: null,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        permissionsJson: body.permissions as object,
        isSystem: false,
      },
    });
    // Cross-tenant audit row stored against the actor's first tenant.
    const callerTenant = await fastify.prisma.membership.findFirst({
      where: { userId: user.id },
      select: { tenantId: true },
    });
    if (callerTenant) {
      await writeAudit(fastify.prisma, request, {
        tenantId: callerTenant.tenantId,
        action: "platform.role.create",
        actorUserId: user.id,
        entityType: "role",
        entityId: role.id,
        metadata: { slug: role.slug },
      });
    }
    return reply.code(201).send({ role });
  });

  fastify.patch("/api/v1/platform/roles/:id", async (request, reply) => {
    await requirePlatformRole(fastify, request, "admin");
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(400).optional(),
        permissions: z.array(z.string()).optional(),
      })
      .parse(request.body);

    const existing = await fastify.prisma.role.findUnique({ where: { id } });
    if (!existing || existing.scope !== "platform") {
      return reply.code(404).send({ error: "not_found" });
    }
    if (existing.isSystem && body.permissions) {
      // System roles can have their description renamed but their
      // permission set is locked — otherwise admins could lock
      // themselves out by editing 'owner' down to nothing.
      return reply.code(409).send({
        error: "system_role_locked",
        message:
          "Built-in roles can't have their permissions edited. Create a custom role instead.",
      });
    }
    const role = await fastify.prisma.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.permissions !== undefined
          ? { permissionsJson: body.permissions as object }
          : {}),
      },
    });
    return reply.send({ role });
  });

  fastify.delete("/api/v1/platform/roles/:id", async (request, reply) => {
    await requirePlatformRole(fastify, request, "admin");
    const { id } = idParam.parse(request.params);
    const existing = await fastify.prisma.role.findUnique({ where: { id } });
    if (!existing || existing.scope !== "platform") {
      return reply.code(404).send({ error: "not_found" });
    }
    if (existing.isSystem) {
      return reply.code(409).send({
        error: "system_role_locked",
        message: "Built-in roles can't be deleted.",
      });
    }
    // Don't orphan users — refuse to delete a role someone still holds.
    const inUse = await fastify.prisma.user.count({
      where: { platformRole: existing.slug },
    });
    if (inUse > 0) {
      return reply.code(409).send({
        error: "role_in_use",
        message: `${inUse} user(s) still hold the "${existing.slug}" role.`,
      });
    }
    await fastify.prisma.role.delete({ where: { id } });
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // Platform branding (sec 11.4) — theme/colors/layout for the platform
  // shell itself: landing page, login page, default email styles. The
  // singleton `PlatformSetting` row holds it.
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/platform/branding", async (request) => {
    await requirePlatformRole(fastify, request, "support");
    const row = await fastify.prisma.platformSetting.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", brandingJson: {} },
      select: { brandingJson: true, updatedAt: true, updatedBy: true },
    });
    return { branding: row.brandingJson, updatedAt: row.updatedAt };
  });

  fastify.put("/api/v1/platform/branding", async (request, reply) => {
    await requirePlatformRole(fastify, request, "admin");
    const user = requireUser(request);
    const body = z.object({ branding: z.record(z.unknown()) }).parse(request.body);
    const row = await fastify.prisma.platformSetting.upsert({
      where: { id: "default" },
      update: {
        brandingJson: body.branding as Prisma.InputJsonValue,
        updatedBy: user.id,
      },
      create: {
        id: "default",
        brandingJson: body.branding as Prisma.InputJsonValue,
        updatedBy: user.id,
      },
      select: { brandingJson: true, updatedAt: true },
    });
    return reply.send({ branding: row.brandingJson, updatedAt: row.updatedAt });
  });

  // -------------------------------------------------------------------------
  // Marketplace — submissions queue + direct-upload (#180)
  // -------------------------------------------------------------------------
  //
  // The submissions queue is "every platform-scope MarketplacePackage
  // whose status is review". Tenants submit by creating a package with
  // scope=platform — the create route already drops it into review.
  // Platform admins use these endpoints to approve / reject without
  // needing to swap into the submitting tenant's workspace.
  //
  // Direct upload is the inverse path: a platform admin creates a
  // package with no submitting tenant (tenantId=null) and we mark it
  // approved on creation so it shows up in the public directory
  // immediately. The existing tenant-scoped create route refuses
  // tenantId=null; this route bypasses that.

  fastify.get(
    "/api/v1/platform/marketplace/submissions",
    async (request) => {
      await requirePlatformRole(fastify, request, "support");

      const q = (request.query as Record<string, string>) ?? {};
      const status = q.status === "all" ? null : (q.status ?? "review");

      const submissions = await fastify.prisma.marketplacePackage.findMany({
        where: {
          scope: "platform",
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          slug: true,
          name: true,
          kind: true,
          category: true,
          summary: true,
          status: true,
          priceCents: true,
          authorName: true,
          tenantId: true,
          publisherId: true,
          createdAt: true,
          updatedAt: true,
          installCount: true,
          ratingAvg10: true,
          ratingCount: true,
          iconAssetId: true,
        },
      });

      // Pull submitting tenant names in one query so the UI can show
      // who submitted what.
      const tenantIds = Array.from(
        new Set(submissions.map((s) => s.tenantId).filter((x): x is string => !!x)),
      );
      const tenants = tenantIds.length
        ? await fastify.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, slug: true, name: true },
          })
        : [];
      const byId = new Map(tenants.map((t) => [t.id, t]));

      return {
        submissions: submissions.map((s) => ({
          ...s,
          submittingTenant: s.tenantId ? byId.get(s.tenantId) ?? null : null,
        })),
      };
    },
  );

  fastify.post(
    "/api/v1/platform/marketplace/submissions/:id/approve",
    async (request, reply) => {
      const role = await requirePlatformRole(fastify, request, "admin");
      const user = requireUser(request);
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);

      const pkg = await fastify.prisma.marketplacePackage.findUnique({
        where: { id },
        select: { id: true, status: true, scope: true, tenantId: true, slug: true },
      });
      if (!pkg) return reply.code(404).send({ error: "not_found" });
      if (pkg.scope !== "platform") {
        return reply.code(400).send({
          error: "wrong_scope",
          message: "Only platform-scope packages flow through the queue.",
        });
      }

      const updated = await fastify.prisma.marketplacePackage.update({
        where: { id },
        data: { status: "approved" },
      });

      // Mark every draft/review version on this package as approved
      // too — the public catalogue won't surface versions otherwise.
      await fastify.prisma.marketplacePackageVersion.updateMany({
        where: { packageId: id, status: { in: ["draft", "review"] } },
        data: { status: "approved", publishedAt: new Date() },
      });

      await writeAudit(fastify.prisma, request, {
        // Use the submitting tenant's id for the audit log if there is
        // one, otherwise leave null so the platform-scope log carries it.
        tenantId: pkg.tenantId ?? null,
        action: "marketplace.package.approve",
        actorUserId: user.id,
        actorRole: `platform:${role}`,
        entityType: "marketplace_package",
        entityId: pkg.id,
        metadata: { slug: pkg.slug },
      });

      return reply.send({ package: updated });
    },
  );

  fastify.post(
    "/api/v1/platform/marketplace/submissions/:id/reject",
    async (request, reply) => {
      const role = await requirePlatformRole(fastify, request, "admin");
      const user = requireUser(request);
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z
        .object({ reason: z.string().max(2000).optional() })
        .parse(request.body ?? {});

      const pkg = await fastify.prisma.marketplacePackage.findUnique({
        where: { id },
        select: { id: true, status: true, scope: true, tenantId: true, slug: true },
      });
      if (!pkg) return reply.code(404).send({ error: "not_found" });

      // Rejection lands the package back in draft so the submitting
      // tenant can edit + resubmit. We don't have a "rejected" status
      // in the schema; "draft" is the recoverable state. The reason is
      // recorded in the audit log so the submitter can read why.
      const updated = await fastify.prisma.marketplacePackage.update({
        where: { id },
        data: { status: "draft" },
      });

      await writeAudit(fastify.prisma, request, {
        tenantId: pkg.tenantId ?? null,
        action: "marketplace.package.reject",
        actorUserId: user.id,
        actorRole: `platform:${role}`,
        entityType: "marketplace_package",
        entityId: pkg.id,
        metadata: { slug: pkg.slug, reason: body.reason ?? "" },
      });

      return reply.send({ package: updated });
    },
  );

  // Direct upload — bypasses the per-tenant create route so platform
  // admins can publish first-party packages without standing up a
  // dummy tenant. The created package is auto-approved (skips the
  // review queue since the platform admin IS the reviewer).
  fastify.post(
    "/api/v1/platform/marketplace/packages",
    async (request, reply) => {
      const role = await requirePlatformRole(fastify, request, "admin");
      const user = requireUser(request);
      const body = z
        .object({
          slug: z
            .string()
            .min(1)
            .max(120)
            .regex(/^[a-z0-9-]+$/),
          name: z.string().min(1).max(200),
          kind: z.string().min(1).max(40),
          category: z.string().max(40).optional(),
          summary: z.string().max(500).default(""),
          description: z.string().max(20000).default(""),
          priceCents: z.number().int().min(0).default(0),
          authorName: z.string().max(200).default("TCGStudio"),
          iconAssetId: z.string().nullable().optional(),
          galleryJson: z.array(z.string()).default([]),
          tagsJson: z.array(z.string()).default([]),
          // Optional first version — when present we create both the
          // package and its initial version in one call.
          version: z
            .object({
              version: z
                .string()
                .min(1)
                .regex(/^\d+\.\d+\.\d+/),
              changelog: z.string().max(20000).default(""),
              contentJson: z.unknown().default({}),
            })
            .optional(),
        })
        .parse(request.body);

      const existing = await fastify.prisma.marketplacePackage.findUnique({
        where: { slug: body.slug },
      });
      if (existing) {
        return reply.code(409).send({ error: "slug_in_use" });
      }

      const pkg = await fastify.prisma.marketplacePackage.create({
        data: {
          slug: body.slug,
          name: body.name,
          kind: body.kind,
          category: body.category ?? null,
          summary: body.summary,
          description: body.description,
          priceCents: body.priceCents,
          authorName: body.authorName,
          scope: "platform",
          // Platform-owned package — no submitting tenant.
          tenantId: null,
          publisherId: null,
          status: "approved",
          iconAssetId: body.iconAssetId ?? null,
          galleryJson: body.galleryJson as object,
          tagsJson: body.tagsJson as object,
        },
      });

      if (body.version) {
        await fastify.prisma.marketplacePackageVersion.create({
          data: {
            packageId: pkg.id,
            version: body.version.version,
            changelog: body.version.changelog,
            contentJson: body.version.contentJson as Prisma.InputJsonValue,
            status: "approved",
            publishedAt: new Date(),
          },
        });
      }

      await writeAudit(fastify.prisma, request, {
        tenantId: null,
        action: "marketplace.package.platform_create",
        actorUserId: user.id,
        actorRole: `platform:${role}`,
        entityType: "marketplace_package",
        entityId: pkg.id,
        metadata: { slug: pkg.slug, kind: pkg.kind },
      });

      return reply.code(201).send({ package: pkg });
    },
  );
}
