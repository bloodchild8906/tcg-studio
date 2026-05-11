/**
 * Lore routes (sec 29).
 *
 * Project-scoped lore entries — worlds, regions, characters, artifacts,
 * events, timelines, story chapters. Single model with a `kind`
 * discriminator; the API doesn't validate the kind beyond a known
 * vocabulary, leaving room for project-specific extensions.
 *
 * Relations to cards / sets / factions / other lore are tracked in the
 * free-form `relationsJson` array — we don't enforce referential
 * integrity here because lore often references cards-in-progress that
 * haven't been published yet, and a hard FK would block authoring.
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const idParam = z.object({ id: z.string().min(1) });

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

const kindSchema = z
  .enum(["world", "region", "character", "artifact", "event", "timeline", "chapter", "custom"])
  .default("character");

const relationSchema = z.object({
  kind: z.enum(["card", "faction", "set", "lore"]),
  id: z.string().optional(),
  slug: z.string().optional(),
  label: z.string().optional(),
});

const createBody = z.object({
  projectId: z.string().min(1),
  kind: kindSchema,
  name: z.string().min(1).max(120),
  slug: slugSchema,
  summary: z.string().max(2000).optional(),
  body: z.string().max(200000).optional(),
  coverAssetId: z.string().min(1).nullable().optional(),
  factionId: z.string().min(1).nullable().optional(),
  setId: z.string().min(1).nullable().optional(),
  relationsJson: z.array(relationSchema).optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
  visibility: z
    .enum(["private", "internal", "public_after_release", "public"])
    .optional(),
  status: z.enum(["draft", "review", "approved", "released", "archived"]).optional(),
  sortOrder: z.number().int().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function loreRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/lore", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = request.query as Record<string, string>;
    const lore = await fastify.prisma.lore.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.factionId ? { factionId: q.factionId } : {}),
        ...(q.setId ? { setId: q.setId } : {}),
      },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return { lore };
  });

  fastify.post("/api/v1/lore", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const entry = await fastify.prisma.lore.create({
      data: {
        tenantId,
        projectId: project.id,
        kind: body.kind,
        name: body.name,
        slug: body.slug,
        summary: body.summary ?? "",
        body: body.body ?? "",
        coverAssetId: body.coverAssetId ?? null,
        factionId: body.factionId ?? null,
        setId: body.setId ?? null,
        relationsJson: (body.relationsJson ?? []) as unknown as Prisma.InputJsonValue,
        metadataJson: (body.metadataJson ?? {}) as unknown as Prisma.InputJsonValue,
        visibility: body.visibility ?? "private",
        status: body.status ?? "draft",
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ lore: entry });
  });

  fastify.get("/api/v1/lore/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const entry = await fastify.prisma.lore.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { lore: entry };
  });

  fastify.patch("/api/v1/lore/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.LoreUpdateInput = {};
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.summary !== undefined) data.summary = body.summary;
    if (body.body !== undefined) data.body = body.body;
    if (body.coverAssetId !== undefined) data.coverAssetId = body.coverAssetId;
    if (body.factionId !== undefined) data.factionId = body.factionId;
    if (body.setId !== undefined) data.setId = body.setId;
    if (body.relationsJson !== undefined) {
      data.relationsJson = body.relationsJson as unknown as Prisma.InputJsonValue;
    }
    if (body.metadataJson !== undefined) {
      data.metadataJson = body.metadataJson as unknown as Prisma.InputJsonValue;
    }
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.status !== undefined) data.status = body.status;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.lore.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const entry = await fastify.prisma.lore.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { lore: entry };
  });

  fastify.delete("/api/v1/lore/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.lore.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
