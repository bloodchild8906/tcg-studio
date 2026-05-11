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
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireUser } from "@/plugins/auth";

const idParam = z.object({ id: z.string().min(1) });

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: "slug must be lowercase, hyphen-separated, no leading/trailing hyphens",
  });

const TENANT_OWNER_ROLES = [
  "tenant_owner",
  "tenant_admin",
  "project_creator",
  "viewer",
] as const;
type TenantOwnerRole = (typeof TENANT_OWNER_ROLES)[number];

const SALT_ROUNDS = 10;

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
  /// When set, the new tenant's first member is the user with this
  /// email. If the user already exists, they're attached with the
  /// supplied `ownerRole` (default: tenant_owner). If they don't,
  /// they're created with the supplied `ownerName` + `ownerPassword`.
  ///
  /// Why this exists: the platform admin needs a one-step "create
  /// tenant for customer X" flow rather than create-tenant-then-
  /// separately-invite-user. Without an owner the tenant ships with
  /// no members and the operator can't even log in to it.
  ///
  /// Behaviour by caller:
  ///   - Platform admin: this field IS the owner. Don't attach the
  ///     caller. If omitted, fall back to attaching the caller.
  ///   - Non-platform caller: ignored — the caller is always the
  ///     owner. (Self-service signup-flow safety.)
  ownerEmail: z.string().email().max(180).optional(),
  ownerName: z.string().min(1).max(120).optional(),
  ownerPassword: z.string().min(8).max(200).optional(),
  ownerRole: z.enum(TENANT_OWNER_ROLES).optional(),
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

    // Resolve who, if anyone, is calling. Two callers we care about:
    //
    //   • A signed-in platform admin minting a tenant on behalf of a
    //     customer. They may specify `ownerEmail` to designate the
    //     tenant's first owner. If the email doesn't exist yet we
    //     create a User with `ownerName` + `ownerPassword`. The caller
    //     themselves is NOT auto-added.
    //
    //   • A signed-in tenant user calling create from within the app
    //     (legacy / self-service flow). `ownerEmail` is ignored — the
    //     caller is always made owner. This preserves the existing
    //     create-my-own-tenant UX and avoids any privilege escalation
    //     via the `ownerEmail` field.
    //
    //   • An anonymous caller (no token). `ownerEmail` is required and
    //     must come with `ownerName` + `ownerPassword` so the new
    //     user is fully provisioned. This is the registration-wizard
    //     code path for first-tenant signup.
    let callerId: string | null = null;
    let callerIsPlatformAdmin = false;
    try {
      const u = requireUser(request);
      callerId = u.id;
      const me = await fastify.prisma.user.findUnique({
        where: { id: u.id },
        select: { platformRole: true },
      });
      callerIsPlatformAdmin =
        me?.platformRole === "owner" || me?.platformRole === "admin";
    } catch {
      callerId = null;
    }

    // Resolve who the first owner should be BEFORE we create the
    // tenant — fail fast on bad input so we never end up with an
    // orphan tenant.
    type OwnerResolution = {
      userId: string;
      role: TenantOwnerRole;
      created: boolean;
    } | null;
    let owner: OwnerResolution = null;

    const ownerEmail = body.ownerEmail?.toLowerCase().trim() || null;
    const wantsExplicitOwner = ownerEmail !== null;
    const role = body.ownerRole ?? "tenant_owner";

    if (wantsExplicitOwner) {
      // Platform admins (and anonymous wizard callers) can specify
      // any owner. Tenant users can't — their tenant is theirs.
      if (callerId && !callerIsPlatformAdmin) {
        return reply.code(403).send({
          error: "owner_not_allowed",
          message:
            "Only platform admins may set a different user as the new tenant's owner.",
        });
      }
      const existing = await fastify.prisma.user.findUnique({
        where: { email: ownerEmail },
        select: { id: true, name: true, passwordHash: true },
      });
      if (existing) {
        // If a password was supplied alongside an existing user, the
        // platform admin is also rotating that user's password as part
        // of the create. That's allowed for platform admins only.
        if (body.ownerPassword && callerIsPlatformAdmin) {
          const hash = await bcrypt.hash(body.ownerPassword, SALT_ROUNDS);
          await fastify.prisma.user.update({
            where: { id: existing.id },
            data: { passwordHash: hash },
          });
        }
        owner = { userId: existing.id, role, created: false };
      } else {
        // Need to create the user — requires a password + name.
        if (!body.ownerPassword) {
          return reply.code(400).send({
            error: "owner_password_required",
            message:
              "No user exists with that email. Provide ownerPassword (and optionally ownerName) to create one.",
          });
        }
        const hash = await bcrypt.hash(body.ownerPassword, SALT_ROUNDS);
        const created = await fastify.prisma.user.create({
          data: {
            email: ownerEmail,
            name: body.ownerName?.trim() || ownerEmail.split("@")[0],
            passwordHash: hash,
          },
          select: { id: true },
        });
        owner = { userId: created.id, role, created: true };
      }
    } else if (callerId && !callerIsPlatformAdmin) {
      // Self-service create — the caller becomes the owner. (Platform
      // admins who omit ownerEmail intentionally get a no-member
      // tenant; they can attach members afterwards. This matches the
      // direct-upload pattern in /api/v1/platform/marketplace.)
      owner = { userId: callerId, role, created: false };
    }

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

    if (owner) {
      await fastify.prisma.membership.create({
        data: {
          tenantId: tenant.id,
          userId: owner.userId,
          role: owner.role,
        },
      });
    }

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
