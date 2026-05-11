/**
 * Audit log read endpoint (sec 41).
 *
 * Tenant admins can list the most recent audit rows. Cursor-paginated
 * by `before` (ISO date) to keep payloads small. Filterable by action
 * prefix and actor.
 *
 * Writes happen via `lib/audit.ts` from the routes that mutate state —
 * the read endpoint here is purely for the Settings → Audit log
 * panel + future SOC 2 export tooling.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const listQuery = z.object({
  /** Match `action` by prefix (e.g. "apikey." returns all apikey events). */
  actionPrefix: z.string().min(1).max(80).optional(),
  /** Filter by exact actor user id. */
  actorUserId: z.string().min(1).optional(),
  /** Cursor — return rows older than this ISO date. */
  before: z.string().optional(),
  /** Page size, capped at 500. */
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export default async function auditRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/audit", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = listQuery.parse(request.query ?? {});
    const limit = q.limit ?? 100;
    const before = q.before ? new Date(q.before) : undefined;

    const rows = await fastify.prisma.auditLog.findMany({
      where: {
        tenantId,
        ...(q.actionPrefix
          ? { action: { startsWith: q.actionPrefix } }
          : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const nextBefore =
      rows.length === limit ? rows[rows.length - 1].createdAt : null;

    return { rows, nextBefore };
  });
}
