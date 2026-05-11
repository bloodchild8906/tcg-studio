/**
 * Project membership routes (sec 13.4).
 *
 * Tenant-scoped — all routes live under the tenant plugin so we always
 * have a tenantId. The point of this file is the per-project access
 * boundary: a tenant member doesn't get into a project automatically
 * anymore (except for the bypass roles owner / admin / project_creator
 * — those are still allowed through at the route gate, but don't appear
 * in this table unless they were explicitly added or backfilled by the
 * migration). Everyone else needs a row here.
 *
 * Endpoints (all under /api/v1/projects/:projectId/members):
 *   GET    list project members
 *   POST   add an existing tenant user as a project member
 *   PATCH  /:id  change role
 *   DELETE /:id  remove from project
 *
 * Auth model:
 *   - Reading the member list requires project access (same gate as
 *     reading the project itself).
 *   - Mutating the member list requires the caller to either be a
 *     tenant bypass-role (owner/admin/project_creator) or hold a
 *     `project_owner` / `project_admin` ProjectMembership on the
 *     project. Plain `viewer` / `game_designer` etc. can read the list
 *     but not change it.
 */

import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import {
  assertProjectAccess,
  ProjectAccessError,
} from "@/lib/projectAccess";

/** 32-byte random token, hex-encoded. Used as the unguessable
 *  redemption secret on Invitation rows. */
function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const PROJECT_ROLES = [
  "project_owner",
  "project_admin",
  "game_designer",
  "card_designer",
  "template_designer",
  "rules_designer",
  "ability_designer",
  "artist",
  "writer",
  "set_manager",
  "export_manager",
  "playtester",
  "viewer",
] as const;

const MUTATION_ROLES = new Set(["project_owner", "project_admin"]);

const idsParam = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
});
const projectParam = z.object({ projectId: z.string().min(1) });

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(PROJECT_ROLES).optional(),
});

const patchBody = z.object({
  role: z.enum(PROJECT_ROLES),
});

/**
 * Caller must be allowed to mutate the project's member list. Returns
 * void on success, throws ProjectAccessError otherwise. Separate from
 * `assertProjectAccess` because read access doesn't imply write access.
 *
 * Only project_owner and project_admin can mutate the member list. No
 * tenant-role bypass — sec 13.4 says project login is independent of
 * tenant role, so a tenant_admin who isn't an explicit project member
 * can't add themselves to the project. They have to either be added
 * by the project owner or set themselves as the owner at create time.
 */
async function assertCanMutateMembers(
  fastify: FastifyInstance,
  request: Parameters<typeof assertProjectAccess>[0]["request"],
  tenantId: string,
  projectId: string,
): Promise<void> {
  // API keys are tenant-scoped admin-equivalent — they can mutate.
  if (request.apiKey) return;
  const userId = request.currentUser?.id;
  if (!userId) throw new ProjectAccessError();

  // Tenant membership still required (so a removed tenant member with
  // a stale session gets blocked). But it's not sufficient on its own.
  const member = await fastify.prisma.membership.findFirst({
    where: { userId, tenantId },
    select: { id: true },
  });
  if (!member) throw new ProjectAccessError();

  const pm = await fastify.prisma.projectMembership.findFirst({
    where: { userId, projectId },
    select: { role: true },
  });
  if (!pm || !MUTATION_ROLES.has(pm.role)) {
    throw new ProjectAccessError();
  }
}

export default async function projectMembershipRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/v1/projects/:projectId/members",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { projectId } = projectParam.parse(request.params);

      // Make sure the project belongs to this tenant before we expose
      // its member list — defense against a stale projectId leaking
      // members across tenant boundaries.
      const project = await fastify.prisma.project.findFirst({
        where: { id: projectId, tenantId },
        select: { id: true },
      });
      if (!project) return reply.code(404).send({ error: "not_found" });

      try {
        await assertProjectAccess({
          prisma: fastify.prisma,
          request,
          tenantId,
          projectId,
        });
      } catch (err) {
        if (err instanceof ProjectAccessError) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const memberships = await fastify.prisma.projectMembership.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });
      return { memberships };
    },
  );

  fastify.post(
    "/api/v1/projects/:projectId/members",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { projectId } = projectParam.parse(request.params);
      const body = inviteBody.parse(request.body);

      const project = await fastify.prisma.project.findFirst({
        where: { id: projectId, tenantId },
        select: { id: true },
      });
      if (!project) return reply.code(404).send({ error: "not_found" });

      try {
        await assertCanMutateMembers(fastify, request, tenantId, projectId);
      } catch (err) {
        if (err instanceof ProjectAccessError) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const role = body.role ?? "game_designer";
      const emailLower = body.email.toLowerCase();
      const user = await fastify.prisma.user.findUnique({
        where: { email: emailLower },
        select: { id: true, email: true, name: true },
      });

      // Two paths depending on whether the invitee has an account.
      if (user) {
        // Existing user — must already be a tenant member, then we
        // create the ProjectMembership directly. Same path as before.
        const tenantMember = await fastify.prisma.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId: user.id } },
          select: { id: true },
        });
        if (!tenantMember) {
          return reply.code(409).send({
            error: "not_tenant_member",
            message:
              "User must be a member of this tenant before they can be added to a project. Add them at the tenant level first.",
          });
        }

        const existing = await fastify.prisma.projectMembership.findUnique({
          where: { projectId_userId: { projectId, userId: user.id } },
          select: { id: true },
        });
        if (existing) {
          return reply.code(409).send({
            error: "already_a_member",
            message: `${user.email} is already a member of this project.`,
          });
        }

        const membership = await fastify.prisma.projectMembership.create({
          data: { projectId, userId: user.id, role },
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        });
        return reply.code(201).send({ membership, kind: "membership" });
      }

      // No account yet — create a pending Invitation. The user
      // redeems it by signing up with the same email; the post-signup
      // hook turns the invitation into a ProjectMembership.
      const existingInvite = await fastify.prisma.invitation.findFirst({
        where: {
          scope: "project",
          tenantId,
          projectId,
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
      const token = randomToken();
      const invite = await fastify.prisma.invitation.create({
        data: {
          scope: "project",
          tenantId,
          projectId,
          email: emailLower,
          role,
          token,
          // 14-day window — long enough for a busy person to redeem,
          // short enough that stale invites don't accumulate forever.
          expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          invitedBy: request.currentUser?.id ?? null,
        },
      });
      return reply.code(201).send({ invitation: invite, kind: "invitation" });
    },
  );

  // Pending invitations on this project.
  fastify.get(
    "/api/v1/projects/:projectId/invitations",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { projectId } = projectParam.parse(request.params);
      try {
        await assertCanMutateMembers(fastify, request, tenantId, projectId);
      } catch (err) {
        if (err instanceof ProjectAccessError) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }
      const invitations = await fastify.prisma.invitation.findMany({
        where: { scope: "project", projectId, status: "pending" },
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
    },
  );

  fastify.delete(
    "/api/v1/projects/:projectId/invitations/:id",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { projectId, id } = idsParam.parse(request.params);
      try {
        await assertCanMutateMembers(fastify, request, tenantId, projectId);
      } catch (err) {
        if (err instanceof ProjectAccessError) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }
      const result = await fastify.prisma.invitation.updateMany({
        where: { id, scope: "project", projectId, status: "pending" },
        data: { status: "revoked" },
      });
      if (result.count === 0) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );

  fastify.patch(
    "/api/v1/projects/:projectId/members/:id",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { projectId, id } = idsParam.parse(request.params);
      const body = patchBody.parse(request.body);

      const project = await fastify.prisma.project.findFirst({
        where: { id: projectId, tenantId },
        select: { id: true },
      });
      if (!project) return reply.code(404).send({ error: "not_found" });

      try {
        await assertCanMutateMembers(fastify, request, tenantId, projectId);
      } catch (err) {
        if (err instanceof ProjectAccessError) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      // Last-owner protection — same shape as tenant-membership delete.
      const target = await fastify.prisma.projectMembership.findFirst({
        where: { id, projectId },
        select: { id: true, role: true },
      });
      if (!target) return reply.code(404).send({ error: "not_found" });

      if (target.role === "project_owner" && body.role !== "project_owner") {
        const ownerCount = await fastify.prisma.projectMembership.count({
          where: { projectId, role: "project_owner" },
        });
        if (ownerCount <= 1) {
          return reply.code(409).send({
            error: "last_owner",
            message: "Can't demote the last project owner.",
          });
        }
      }

      const updated = await fastify.prisma.projectMembership.update({
        where: { id },
        data: { role: body.role },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });
      return { membership: updated };
    },
  );

  fastify.delete(
    "/api/v1/projects/:projectId/members/:id",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { projectId, id } = idsParam.parse(request.params);

      const project = await fastify.prisma.project.findFirst({
        where: { id: projectId, tenantId },
        select: { id: true },
      });
      if (!project) return reply.code(404).send({ error: "not_found" });

      try {
        await assertCanMutateMembers(fastify, request, tenantId, projectId);
      } catch (err) {
        if (err instanceof ProjectAccessError) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const target = await fastify.prisma.projectMembership.findFirst({
        where: { id, projectId },
        select: { id: true, role: true },
      });
      if (!target) return reply.code(404).send({ error: "not_found" });

      if (target.role === "project_owner") {
        const ownerCount = await fastify.prisma.projectMembership.count({
          where: { projectId, role: "project_owner" },
        });
        if (ownerCount <= 1) {
          return reply.code(409).send({
            error: "last_owner",
            message:
              "Can't remove the last project owner. Promote another member first.",
          });
        }
      }

      await fastify.prisma.projectMembership.delete({ where: { id } });
      return reply.code(204).send();
    },
  );
}
