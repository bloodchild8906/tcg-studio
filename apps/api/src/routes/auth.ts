/**
 * Auth routes — top-level (no tenant scope).
 *
 *   POST /api/v1/auth/signup    create a user, return token
 *   POST /api/v1/auth/login     verify creds, return token
 *   GET  /api/v1/auth/me        current user + their memberships (requires token)
 *
 * Signup also creates a personal tenant + membership in one transaction so
 * the new user lands in a usable workspace immediately. They can create more
 * tenants from Settings later.
 */

import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireUser } from "@/plugins/auth";

const signupBody = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120),
  /// If set, the new user is added to this existing tenant by slug.
  /// Otherwise a personal tenant is created automatically.
  tenantSlug: z.string().min(1).max(80).optional(),
  /// Invitation redemption token. When present + valid:
  ///   - The signup creates the user but DOES NOT mint a personal
  ///     tenant. The user is purely a member of the level(s) they
  ///     were invited to (platform/tenant/project).
  ///   - The invite's `email` MUST match the submitted email,
  ///     otherwise the request is rejected. (Otherwise an attacker
  ///     could reuse a token by signing up with a different email.)
  ///   - Pending invites for that email are still redeemed in the
  ///     same transaction, so a single signup can resolve multiple
  ///     pending invites.
  invitationToken: z.string().min(20).max(128).optional(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SALT_ROUNDS = 10;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/auth/signup", async (request, reply) => {
    const body = signupBody.parse(request.body);

    // Reject duplicate emails up-front for a friendlier error than the
    // Prisma unique-constraint violation.
    const existing = await fastify.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({
        error: "email_taken",
        message: "An account with that email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);

    // If the signup is redeeming an Invitation token, validate up-
    // front so we can short-circuit the personal-tenant flow. The
    // invite's email must match the submitted email exactly — that
    // guards against a stolen token being used with a different
    // identity.
    let invitationContext:
      | {
          id: string;
          scope: string;
          tenantId: string | null;
          projectId: string | null;
          role: string;
        }
      | null = null;
    if (body.invitationToken) {
      const inv = await fastify.prisma.invitation.findUnique({
        where: { token: body.invitationToken },
        select: {
          id: true,
          scope: true,
          tenantId: true,
          projectId: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
        },
      });
      if (!inv) {
        return reply.code(404).send({
          error: "invitation_not_found",
          message: "This invitation link is invalid or has already been used.",
        });
      }
      if (inv.status !== "pending") {
        return reply.code(409).send({
          error: "invitation_not_pending",
          message: `This invitation is ${inv.status}.`,
        });
      }
      if (inv.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({
          error: "invitation_expired",
          message: "This invitation has expired. Ask the inviter to send a new one.",
        });
      }
      if (inv.email.toLowerCase() !== body.email.toLowerCase()) {
        return reply.code(403).send({
          error: "invitation_email_mismatch",
          message:
            "This invitation was sent to a different email address. Sign up with the address it was sent to.",
        });
      }
      invitationContext = {
        id: inv.id,
        scope: inv.scope,
        tenantId: inv.tenantId,
        projectId: inv.projectId,
        role: inv.role,
      };
    }

    // Create the user, the appropriate memberships, and (when not
    // signing up via an invitation) a personal tenant — all in one
    // transaction so a half-state is impossible.
    const result = await fastify.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          name: body.name,
          passwordHash,
        },
        select: { id: true, email: true, name: true },
      });

      // Pick the "primary" tenant we report back to the client. This
      // is purely a UX hint — the frontend uses it to redirect into
      // a workspace after signup. With an invitation we point at the
      // inviting tenant; without one we mint a personal tenant.
      let tenantId: string | null = null;
      if (invitationContext) {
        // Invitation-only signup: NO personal tenant. The user only
        // exists as a member of the inviting level.
        if (invitationContext.scope === "platform") {
          if (
            invitationContext.role === "owner" ||
            invitationContext.role === "admin" ||
            invitationContext.role === "support"
          ) {
            await tx.user.update({
              where: { id: user.id },
              data: { platformRole: invitationContext.role },
            });
          }
          // Platform invitees have no tenantId to land on; the
          // frontend will route them to the platform host.
          tenantId = null;
        } else if (
          invitationContext.scope === "tenant" &&
          invitationContext.tenantId
        ) {
          await tx.membership.create({
            data: {
              tenantId: invitationContext.tenantId,
              userId: user.id,
              role: invitationContext.role,
            },
          });
          tenantId = invitationContext.tenantId;
        } else if (
          invitationContext.scope === "project" &&
          invitationContext.tenantId &&
          invitationContext.projectId
        ) {
          // Project invitees need a tenant Membership too (with the
          // generic "viewer" role) so they can resolve into the
          // tenant's API surface. The ProjectMembership is what
          // actually lets them open the project.
          await tx.membership.create({
            data: {
              tenantId: invitationContext.tenantId,
              userId: user.id,
              role: "viewer",
            },
          });
          await tx.projectMembership.create({
            data: {
              projectId: invitationContext.projectId,
              userId: user.id,
              role: invitationContext.role,
            },
          });
          tenantId = invitationContext.tenantId;
        }
        // Mark the redeemed invitation accepted.
        await tx.invitation.update({
          where: { id: invitationContext.id },
          data: { status: "accepted", acceptedAt: new Date() },
        });
      } else if (body.tenantSlug) {
        // Joining an existing tenant via slug — same membership-only
        // path as invitations, just without a token. (Used by the
        // signup-on-tenant-subdomain flow.)
        const t = await tx.tenant.findUnique({
          where: { slug: body.tenantSlug },
          select: { id: true },
        });
        if (!t) throw new Error("tenant_not_found");
        tenantId = t.id;
        await tx.membership.create({
          data: { userId: user.id, tenantId, role: "viewer" },
        });
      } else {
        // No invitation, no tenant slug — mint a personal tenant.
        const t = await tx.tenant.create({
          data: {
            name: `${body.name}'s workspace`,
            slug: slugify(`${body.email.split("@")[0]}-${Date.now().toString(36).slice(-4)}`),
          },
          select: { id: true },
        });
        tenantId = t.id;
        await tx.membership.create({
          data: { userId: user.id, tenantId, role: "tenant_owner" },
        });
      }

      // Redeem any pending Invitations addressed to this email.
      // Platform invites set User.platformRole; tenant invites add a
      // Membership; project invites add a tenant Membership (if
      // missing) AND a ProjectMembership. The personal tenant created
      // above is independent of any incoming invitations.
      const pending = await tx.invitation.findMany({
        where: { email: body.email.toLowerCase(), status: "pending" },
      });
      for (const inv of pending) {
        if (inv.expiresAt.getTime() < Date.now()) {
          await tx.invitation.update({
            where: { id: inv.id },
            data: { status: "expired" },
          });
          continue;
        }
        if (inv.scope === "platform") {
          if (
            inv.role === "owner" ||
            inv.role === "admin" ||
            inv.role === "support"
          ) {
            await tx.user.update({
              where: { id: user.id },
              data: { platformRole: inv.role },
            });
          }
        } else if (inv.scope === "tenant" && inv.tenantId) {
          const existing = await tx.membership.findUnique({
            where: {
              tenantId_userId: { tenantId: inv.tenantId, userId: user.id },
            },
            select: { id: true },
          });
          if (!existing) {
            await tx.membership.create({
              data: {
                tenantId: inv.tenantId,
                userId: user.id,
                role: inv.role,
              },
            });
          }
        } else if (inv.scope === "project" && inv.tenantId && inv.projectId) {
          const tenantMember = await tx.membership.findUnique({
            where: {
              tenantId_userId: { tenantId: inv.tenantId, userId: user.id },
            },
            select: { id: true },
          });
          if (!tenantMember) {
            await tx.membership.create({
              data: {
                tenantId: inv.tenantId,
                userId: user.id,
                role: "viewer",
              },
            });
          }
          const projectMember = await tx.projectMembership.findUnique({
            where: {
              projectId_userId: { projectId: inv.projectId, userId: user.id },
            },
            select: { id: true },
          });
          if (!projectMember) {
            await tx.projectMembership.create({
              data: {
                projectId: inv.projectId,
                userId: user.id,
                role: inv.role,
              },
            });
          }
        }
        await tx.invitation.update({
          where: { id: inv.id },
          data: { status: "accepted", acceptedAt: new Date() },
        });
      }

      return { user, tenantId };
    });

    const token = await reply.jwtSign({
      sub: result.user.id,
      email: result.user.email,
    });

    return reply.code(201).send({
      user: result.user,
      tenantId: result.tenantId,
      token,
    });
  });

  /**
   * Preview an invitation by token without consuming it. The signup
   * page calls this on mount when the URL carries `?invite=<token>`
   * so it can lock the email field, show the inviter, and tell the
   * user "You're joining Acme as project_owner". The endpoint
   * intentionally returns minimal info — we don't want to leak the
   * inviter's email to a stranger holding a token.
   */
  fastify.get("/api/v1/auth/invitations/:token", async (request, reply) => {
    const params = request.params as { token?: string };
    const token = params.token;
    if (!token) return reply.code(400).send({ error: "missing_token" });
    const inv = await fastify.prisma.invitation.findUnique({
      where: { token },
      select: {
        id: true,
        scope: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        message: true,
        tenantId: true,
        projectId: true,
      },
    });
    if (!inv) return reply.code(404).send({ error: "not_found" });
    if (inv.status !== "pending") {
      return reply.code(409).send({ error: "not_pending", status: inv.status });
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: "expired" });
    }
    // Resolve display names for the inviting tenant + project, but
    // don't leak the inviter's user info or anything not strictly
    // needed for the signup screen.
    const tenant = inv.tenantId
      ? await fastify.prisma.tenant.findUnique({
          where: { id: inv.tenantId },
          select: { name: true, slug: true },
        })
      : null;
    const project = inv.projectId
      ? await fastify.prisma.project.findUnique({
          where: { id: inv.projectId },
          select: { name: true, slug: true },
        })
      : null;
    return {
      invitation: {
        scope: inv.scope,
        email: inv.email,
        role: inv.role,
        message: inv.message,
        expiresAt: inv.expiresAt,
        tenant,
        project,
      },
    };
  });

  fastify.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    const user = await fastify.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
    // Constant-ish-time response: still hash the candidate against a dummy
    // when the user doesn't exist, so timing doesn't leak account existence.
    if (!user || !user.passwordHash) {
      await bcrypt.compare(body.password, "$2a$10$invalidsaltinvalidsaltinvuO9");
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const token = await reply.jwtSign({ sub: user.id, email: user.email });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      token,
    };
  });

  fastify.get("/api/v1/auth/me", async (request, reply) => {
    const user = requireUser(request);
    const memberships = await fastify.prisma.membership.findMany({
      where: { userId: user.id },
      include: {
        tenant: {
          select: { id: true, name: true, slug: true, status: true, brandingJson: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({
      user,
      memberships: memberships.map((m) => ({
        id: m.id,
        role: m.role,
        tenant: m.tenant,
      })),
    });
  });
}
