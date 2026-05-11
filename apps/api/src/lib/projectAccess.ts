/**
 * Project-membership gate (sec 13.4).
 *
 * Per the platform auth policy, tenant role does NOT confer project
 * access. Even a tenant_owner who creates a project doesn't
 * automatically get to log in to it; they specify an `ownerEmail` at
 * project create time, and only that user (and anyone the owner
 * subsequently adds) can sign in to the project subdomain.
 *
 * The rule:
 *
 *   1. The user must hold an explicit `ProjectMembership` row for the
 *      target project. No tenant-role bypass — strict separation
 *      between tenant management and project login.
 *
 *   2. API-key principals always pass (the key already encodes which
 *      tenant it can act on, and keys are issued by tenant admins).
 *
 * Used in two ways:
 *
 *   • `assertProjectAccess(prisma, request, projectId)` throws a 403
 *     when the user can't read the project.
 *
 *   • `visibleProjectIds(prisma, tenantId, userId)` returns the set
 *     of project ids the user can see. Drives the Projects view
 *     filter so users only see projects they can actually open.
 */

import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";

export class ProjectAccessError extends Error {
  statusCode = 403;
  constructor() {
    super("project access denied");
  }
}

interface AccessContext {
  prisma: PrismaClient;
  request: FastifyRequest;
  tenantId: string;
  projectId: string;
}

export async function assertProjectAccess(ctx: AccessContext): Promise<void> {
  // System actor (API key) — already scoped to a tenant, trust it.
  if (ctx.request.apiKey) return;

  const userId = ctx.request.currentUser?.id;
  if (!userId) throw new ProjectAccessError();

  // Tenant membership is necessary but NOT sufficient — being a
  // tenant member doesn't give project access on its own. We still
  // check it so a stale session for a removed user gets rejected with
  // the same code path.
  const tenantMember = await ctx.prisma.membership.findFirst({
    where: { userId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!tenantMember) throw new ProjectAccessError();

  // Explicit project membership is the only path in.
  const pm = await ctx.prisma.projectMembership.findFirst({
    where: { userId, projectId: ctx.projectId },
    select: { id: true },
  });
  if (!pm) throw new ProjectAccessError();
}

/** Returns the project ids in `tenantId` that `userId` can read.
 *  Always the union of their explicit ProjectMembership rows; tenant
 *  role doesn't expand this set (sec 13.4). */
export async function visibleProjectIds(
  prisma: PrismaClient,
  tenantId: string,
  userId: string | null | undefined,
): Promise<{ all: true } | { all: false; ids: Set<string> }> {
  if (!userId) return { all: false, ids: new Set() };
  // A user must still be a tenant member at all (otherwise we won't
  // even try to enumerate their project memberships).
  const tenantMember = await prisma.membership.findFirst({
    where: { userId, tenantId },
    select: { id: true },
  });
  if (!tenantMember) return { all: false, ids: new Set() };
  const rows = await prisma.projectMembership.findMany({
    where: { userId, project: { tenantId } },
    select: { projectId: true },
  });
  return { all: false, ids: new Set(rows.map((r) => r.projectId)) };
}
