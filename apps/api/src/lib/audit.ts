/**
 * Audit log helper.
 *
 * Routes that modify security- or billing-relevant state call
 * `writeAudit(...)` to append a row to the AuditLog table. The helper
 * is intentionally fire-and-forget — failures don't block the
 * caller's primary work — but errors are logged so we notice if the
 * audit pipeline silently breaks.
 *
 * Action naming: dot-namespaced lowercase, verb-last. Examples:
 *   tenant.update      project.delete    member.role.change
 *   domain.add         domain.verify     apikey.create
 *   apikey.revoke      cms.page.publish  cms.page.unpublish
 */

import type { FastifyRequest } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";

export interface AuditInput {
  tenantId: string;
  action: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  prisma: PrismaClient,
  request: FastifyRequest | null,
  input: AuditInput,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        ipAddress: request?.ip ?? null,
        userAgent:
          (request?.headers["user-agent"] as string | undefined) ?? null,
        metadataJson: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Audit write failures shouldn't blow up the request. Log loudly
    // so an operator can notice via the API container logs.
    request?.log.error({ err, action: input.action }, "audit log write failed");
  }
}
