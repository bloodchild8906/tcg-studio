/**
 * Faction routes (sec 28).
 *
 * Per-project faction registry. Same shape as keywords / sets — list
 * filtered by projectId, full CRUD, tenant ownership cross-checked on
 * every write. Factions carry the visual hooks (color, frame asset,
 * icon asset) the variant system uses to swap card art per-faction.
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
  name: z.string().min(1).max(80),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  color: colorSchema.optional(),
  iconAssetId: z.string().min(1).nullable().optional(),
  imageAssetId: z.string().min(1).nullable().optional(),
  frameAssetId: z.string().min(1).nullable().optional(),
  mechanicsJson: z.array(z.string()).optional(),
  lore: z.string().max(40000).optional(),
  status: z.enum(["draft", "approved", "deprecated"]).optional(),
  sortOrder: z.number().int().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function factionRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/factions", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const factions = await fastify.prisma.faction.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { factions };
  });

  fastify.post("/api/v1/factions", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const faction = await fastify.prisma.faction.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        color: body.color ?? "#888888",
        iconAssetId: body.iconAssetId ?? null,
        imageAssetId: body.imageAssetId ?? null,
        frameAssetId: body.frameAssetId ?? null,
        mechanicsJson: (body.mechanicsJson ?? []) as unknown as Prisma.InputJsonValue,
        lore: body.lore ?? "",
        status: body.status ?? "draft",
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ faction });
  });

  fastify.get("/api/v1/factions/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const faction = await fastify.prisma.faction.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { faction };
  });

  fastify.patch("/api/v1/factions/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.FactionUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.color !== undefined) data.color = body.color;
    if (body.iconAssetId !== undefined) data.iconAssetId = body.iconAssetId;
    if (body.imageAssetId !== undefined) data.imageAssetId = body.imageAssetId;
    if (body.frameAssetId !== undefined) data.frameAssetId = body.frameAssetId;
    if (body.mechanicsJson !== undefined) {
      data.mechanicsJson = body.mechanicsJson as unknown as Prisma.InputJsonValue;
    }
    if (body.lore !== undefined) data.lore = body.lore;
    if (body.status !== undefined) data.status = body.status;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.faction.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const faction = await fastify.prisma.faction.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { faction };
  });

  fastify.delete("/api/v1/factions/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.faction.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
