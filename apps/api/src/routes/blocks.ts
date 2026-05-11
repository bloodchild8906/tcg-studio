/**
 * Block routes (sec 27.3).
 *
 * Blocks group sets into a story arc / release season. Same shape as the
 * other project-scoped resources (factions, keywords): list filtered by
 * projectId, full CRUD, tenant ownership cross-checked on every write.
 *
 * Block deletion does NOT cascade to sets — the schema's `onDelete:
 * SetNull` nulls out `Set.blockId` instead. Sets survive when a block
 * is reorganized or retired.
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const idParam = z.object({ id: z.string().min(1) });

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

const colorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  color: colorSchema.optional(),
  sortOrder: z.number().int().optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "concluded", "archived"]).optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function blockRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/blocks", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const blocks = await fastify.prisma.block.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { sets: true } } },
    });
    return {
      blocks: blocks.map(({ _count, ...b }) => ({ ...b, setCount: _count.sets })),
    };
  });

  fastify.post("/api/v1/blocks", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const block = await fastify.prisma.block.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        color: body.color ?? "#888888",
        sortOrder: body.sortOrder ?? 0,
        metadataJson: (body.metadataJson ?? {}) as unknown as Prisma.InputJsonValue,
        status: body.status ?? "draft",
      },
    });
    return reply.code(201).send({ block });
  });

  fastify.get("/api/v1/blocks/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const block = await fastify.prisma.block.findFirstOrThrow({
      where: { id, tenantId },
      include: { _count: { select: { sets: true } } },
    });
    const { _count, ...rest } = block;
    return { block: { ...rest, setCount: _count.sets } };
  });

  fastify.patch("/api/v1/blocks/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.BlockUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.color !== undefined) data.color = body.color;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.metadataJson !== undefined) {
      data.metadataJson = body.metadataJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;

    const result = await fastify.prisma.block.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const block = await fastify.prisma.block.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { block };
  });

  fastify.delete("/api/v1/blocks/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.block.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
