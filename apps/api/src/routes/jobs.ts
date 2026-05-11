/**
 * Background-job inspection routes (sec 38).
 *
 *   GET    /api/v1/jobs               list recent jobs (filterable by status, type)
 *   GET    /api/v1/jobs/:id           full row including resultJson
 *   POST   /api/v1/jobs/:id/cancel    mark a queued/running job as cancelled
 *   POST   /api/v1/jobs/:id/retry     re-queue a failed job (resets attempts)
 *   POST   /api/v1/jobs               manually enqueue (admin tool — type must be a registered handler)
 *
 * Workers run in-process; this surface is purely for observation +
 * manual operator intervention. Audit log captures cancel/retry/enqueue.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  status: z
    .enum(["queued", "running", "completed", "failed", "cancelled"])
    .optional(),
  type: z.string().min(1).max(120).optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const enqueueBody = z.object({
  type: z.string().min(1).max(120),
  payload: z.record(z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  runAt: z.string().datetime().optional(),
});

export default async function jobRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/jobs", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = listQuery.parse(request.query ?? {});
    const limit = q.limit ?? 100;
    const before = q.before ? new Date(q.before) : undefined;
    const rows = await fastify.prisma.job.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const nextBefore =
      rows.length === limit ? rows[rows.length - 1].createdAt : null;
    return { jobs: rows, nextBefore };
  });

  fastify.get("/api/v1/jobs/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const job = await fastify.prisma.job.findFirst({
      where: { id, tenantId },
    });
    if (!job) return reply.code(404).send({ error: "not_found" });
    return { job };
  });

  fastify.post("/api/v1/jobs/:id/cancel", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.job.updateMany({
      where: { id, tenantId, status: { in: ["queued", "running"] } },
      data: { status: "cancelled", completedAt: new Date() },
    });
    if (result.count === 0)
      return reply.code(404).send({ error: "not_found_or_terminal" });
    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "job.cancel",
      actorUserId: user.id,
      entityType: "job",
      entityId: id,
    });
    const job = await fastify.prisma.job.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { job };
  });

  fastify.post("/api/v1/jobs/:id/retry", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.job.updateMany({
      where: { id, tenantId, status: { in: ["failed", "cancelled"] } },
      data: {
        status: "queued",
        attempts: 0,
        lastError: null,
        nextRunAt: new Date(),
        startedAt: null,
        completedAt: null,
      },
    });
    if (result.count === 0)
      return reply.code(404).send({ error: "not_found_or_not_retryable" });
    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "job.retry",
      actorUserId: user.id,
      entityType: "job",
      entityId: id,
    });
    const job = await fastify.prisma.job.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { job };
  });

  fastify.post("/api/v1/jobs", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const body = enqueueBody.parse(request.body);
    const job = await enqueueJob(fastify.prisma, {
      tenantId,
      type: body.type,
      payload: body.payload,
      maxAttempts: body.maxAttempts,
      runAt: body.runAt ? new Date(body.runAt) : undefined,
      createdBy: user.id,
    });
    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "job.enqueue",
      actorUserId: user.id,
      entityType: "job",
      entityId: job.id,
      metadata: { type: body.type },
    });
    return reply.code(201).send({ job });
  });
}
