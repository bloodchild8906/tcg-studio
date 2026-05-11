/**
 * Ability routes (sec 24).
 *
 * Project-scoped catalog of rules-text fragments. Cards reference
 * abilities from `dataJson.abilities` (array of ids) — the printed
 * rules block is composed by joining the referenced abilities' `text`
 * fields, optionally with their `reminderText` italicised below.
 *
 * The future visual graph editor (sec 24.2) lives in `graphJson` —
 * we provision the column now so authors who type text today have a
 * smooth upgrade path when the graph runtime ships.
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
  .enum(["static", "triggered", "activated", "replacement", "prevention", "resource", "combat"])
  .default("static");

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  kind: kindSchema.optional(),
  text: z.string().max(4000).optional(),
  reminderText: z.string().max(2000).optional(),
  trigger: z.string().max(400).optional(),
  cost: z.string().max(200).optional(),
  keywordId: z.string().min(1).nullable().optional(),
  relatedCardIds: z.array(z.string().min(1)).optional(),
  graphJson: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "review", "approved", "deprecated"]).optional(),
  sortOrder: z.number().int().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function abilityRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/abilities", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = request.query as Record<string, string>;
    const abilities = await fastify.prisma.ability.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.keywordId ? { keywordId: q.keywordId } : {}),
      },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return { abilities };
  });

  fastify.post("/api/v1/abilities", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const ability = await fastify.prisma.ability.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        kind: body.kind ?? "static",
        text: body.text ?? "",
        reminderText: body.reminderText ?? "",
        trigger: body.trigger ?? "",
        cost: body.cost ?? "",
        keywordId: body.keywordId ?? null,
        relatedCardIds: (body.relatedCardIds ?? []) as unknown as Prisma.InputJsonValue,
        graphJson: (body.graphJson ?? {}) as unknown as Prisma.InputJsonValue,
        status: body.status ?? "draft",
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ ability });
  });

  fastify.get("/api/v1/abilities/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const ability = await fastify.prisma.ability.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { ability };
  });

  fastify.patch("/api/v1/abilities/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.AbilityUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.text !== undefined) data.text = body.text;
    if (body.reminderText !== undefined) data.reminderText = body.reminderText;
    if (body.trigger !== undefined) data.trigger = body.trigger;
    if (body.cost !== undefined) data.cost = body.cost;
    if (body.keywordId !== undefined) data.keywordId = body.keywordId;
    if (body.relatedCardIds !== undefined) {
      data.relatedCardIds = body.relatedCardIds as unknown as Prisma.InputJsonValue;
    }
    if (body.graphJson !== undefined) {
      data.graphJson = body.graphJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.ability.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const ability = await fastify.prisma.ability.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { ability };
  });

  fastify.delete("/api/v1/abilities/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.ability.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
