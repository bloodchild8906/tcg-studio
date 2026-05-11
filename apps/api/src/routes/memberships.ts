/**
 * Membership routes (sec 13).
 *
 * Tenant-scoped — needs a tenant context, so it lives below the tenant plugin.
 * Anyone with the tenant slug can hit these in v0; once we tighten auth
 * we'll require role >= "tenant_admin" for write operations.
 *
 * Endpoints:
 *   GET    /api/v1/memberships              list members of current tenant
 *   POST   /api/v1/memberships              add a user by email (must already exist)
 *   PATCH  /api/v1/memberships/:id          change role
 *   DELETE /api/v1/memberships/:id          remove from tenant
 */

import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const idParam = z.object({ id: z.string().min(1) });

const ROLES = [
  "tenant_owner",
  "tenant_admin",
  "billing_admin",
  "brand_manager",
  "domain_manager",
  "plugin_manager",
  "security_admin",
  "audit_viewer",
  "project_creator",
  "viewer",
] as const;

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(ROLES).optional(),
});

const patchBody = z.object({
  role: z.enum(ROLES),
});

export default async function membershipRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/memberships", async (request) => {
    const { tenantId } = requireTenant(request);
    const memberships = await fastify.prisma.membership.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return { memberships };
  });

  fastify.post("/api/v1/memberships", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = inviteBody.parse(request.body);

    const role = body.role ?? "viewer";
    const emailLower = body.email.toLowerCase();
    const user = await fastify.prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true, email: true, name: true },
    });

    // Existing user — create the Membership directly.
    if (user) {
      const existing = await fastify.prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        select: { id: true },
      });
      if (existing) {
        return reply.code(409).send({
          error: "already_a_member",
          message: `${user.email} is already a member of this tenant.`,
        });
      }
      const membership = await fastify.prisma.membership.create({
        data: { tenantId, userId: user.id, role },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });
      return reply.code(201).send({ membership, kind: "membership" });
    }

    // No account yet — create a pending Invitation. The redeemed
    // invite turns into a Membership at signup time.
    const existingInvite = await fastify.prisma.invitation.findFirst({
      where: {
        scope: "tenant",
        tenantId,
        email: emailLower,
        status: "pending",
      },
      select: { id: true },
    });
    if (existingInvite) {
      return reply.code(409).send({
        error: "invite_pending",
        message: `An invitation is already pending for ${emailLower}.`,
      });
    }
    const invite = await fastify.prisma.invitation.create({
      data: {
        scope: "tenant",
        tenantId,
        email: emailLower,
        role,
        token: randomToken(),
        expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        invitedBy: request.currentUser?.id ?? null,
      },
    });
    return reply.code(201).send({ invitation: invite, kind: "invitation" });
  });

  // List + revoke pending invitations for the current tenant.
  fastify.get("/api/v1/invitations", async (request) => {
    const { tenantId } = requireTenant(request);
    const invitations = await fastify.prisma.invitation.findMany({
      where: { scope: "tenant", tenantId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { invitations };
  });

  fastify.delete("/api/v1/invitations/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.invitation.updateMany({
      where: { id, scope: "tenant", tenantId, status: "pending" },
      data: { status: "revoked" },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  fastify.patch("/api/v1/memberships/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const result = await fastify.prisma.membership.updateMany({
      where: { id, tenantId },
      data: { role: body.role },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const membership = await fastify.prisma.membership.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return { membership };
  });

  fastify.delete("/api/v1/memberships/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);

    // Prevent self-eviction-of-the-last-owner: at least one tenant_owner must
    // remain, otherwise the tenant becomes orphaned.
    const target = await fastify.prisma.membership.findFirst({
      where: { id, tenantId },
      select: { id: true, role: true, userId: true },
    });
    if (!target) return reply.code(404).send({ error: "not_found" });

    if (target.role === "tenant_owner") {
      const ownerCount = await fastify.prisma.membership.count({
        where: { tenantId, role: "tenant_owner" },
      });
      if (ownerCount <= 1) {
        return reply.code(409).send({
          error: "last_owner",
          message:
            "Can't remove the last owner. Transfer ownership first or delete the tenant.",
        });
      }
    }

    await fastify.prisma.membership.delete({ where: { id: target.id } });
    return reply.code(204).send();
  });
}
