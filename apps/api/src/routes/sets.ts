/**
 * Set routes (sec 27).
 *
 * Sets group cards into release blocks. One project has many sets; a card
 * belongs to at most one set (`Card.setId` is nullable). Set deletion does
 * NOT cascade to cards — it nulls out their `setId` so cards survive when a
 * release is reorganised. (Schema enforces this via `onDelete: SetNull`.)
 *
 * Endpoints:
 *   GET    /api/v1/sets?projectId=...   list sets in this tenant (optionally
 *                                       filtered to a single project)
 *   POST   /api/v1/sets                  create
 *   GET    /api/v1/sets/:id              fetch one
 *   PATCH  /api/v1/sets/:id              partial update
 *   DELETE /api/v1/sets/:id              delete
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const packSlotSchema = z.object({
  rarity: z.string().min(1).max(40),
  count: z.number().int().min(0).max(100),
  /** Optional weighted distribution within the rarity bucket. */
  weights: z.record(z.string(), z.number()).optional(),
});

const packProfileSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  kind: z
    .enum([
      "booster",
      "starter_deck",
      "draft",
      "promo",
      "fixed",
      "random",
      "faction_pack",
      "sealed_pool",
      "commander_deck",
      "custom",
    ])
    .default("booster"),
  slots: z.array(packSlotSchema).default([]),
  totalCount: z.number().int().min(0).max(200).optional(),
  duplicates: z.boolean().optional(),
});

/**
 * Pack rules — accepts the new multi-profile shape OR the legacy single-
 * rules shape for backwards compatibility. Either is normalised into
 * `{ profiles: [...] }` before storage so future reads stay clean.
 */
const packRulesSchema = z.union([
  // New shape — multi-profile.
  z.object({
    profiles: z.array(packProfileSchema).default([]),
  }),
  // Legacy shape — single rules. Upgraded on save into one default profile.
  z.object({
    slots: z.array(packSlotSchema).default([]),
    totalCount: z.number().int().min(0).max(200).optional(),
    duplicates: z.boolean().optional(),
  }),
  // Empty (newly-created set with default {}).
  z.object({}).strict(),
]);

/**
 * Normalise an incoming rules blob into the canonical multi-profile shape.
 */
function normalizePackRules(input: unknown):
  | { profiles: Array<z.infer<typeof packProfileSchema>> }
  | undefined {
  if (input == null) return undefined;
  const parsed = packRulesSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const v = parsed.data as Record<string, unknown>;
  if (Array.isArray((v as { profiles?: unknown }).profiles)) {
    return { profiles: (v as { profiles: z.infer<typeof packProfileSchema>[] }).profiles };
  }
  if (Array.isArray((v as { slots?: unknown }).slots)) {
    return {
      profiles: [
        {
          id: "default",
          name: "Booster",
          kind: "booster",
          slots: (v as { slots: z.infer<typeof packSlotSchema>[] }).slots,
          totalCount: (v as { totalCount?: number }).totalCount,
          duplicates: (v as { duplicates?: boolean }).duplicates,
        },
      ],
    };
  }
  return { profiles: [] };
}

const idParam = z.object({ id: z.string().min(1) });

const codeSchema = z
  .string()
  .min(1)
  .max(8)
  // Standard MTG/L5R-style set code: uppercase letters / digits.
  .regex(/^[A-Z0-9]+$/, {
    message: "code must be uppercase A-Z or 0-9 only (e.g. CORE, MYT, EX01)",
  });

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  code: codeSchema,
  description: z.string().max(2000).optional(),
  releaseDate: z.string().datetime().optional(),
  status: z
    .enum(["draft", "design", "playtesting", "locked", "released", "archived"])
    .optional(),
  packRulesJson: packRulesSchema.optional(),
  blockId: z.string().min(1).nullable().optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  code: codeSchema.optional(),
  description: z.string().max(2000).optional(),
  releaseDate: z.string().datetime().nullable().optional(),
  status: z
    .enum(["draft", "design", "playtesting", "locked", "released", "archived"])
    .optional(),
  packRulesJson: packRulesSchema.optional(),
  blockId: z.string().min(1).nullable().optional(),
});

export default async function setRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/sets", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const sets = await fastify.prisma.set.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { cards: true } } },
    });
    // Flatten card count into a top-level field so the client doesn't have to
    // know about Prisma's `_count` shape.
    return {
      sets: sets.map(({ _count, ...s }) => ({ ...s, cardCount: _count.cards })),
    };
  });

  fastify.post("/api/v1/sets", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const normalised = normalizePackRules(body.packRulesJson);
    const set = await fastify.prisma.set.create({
      data: {
        tenantId,
        projectId: project.id,
        blockId: body.blockId ?? null,
        name: body.name,
        code: body.code,
        description: body.description ?? "",
        releaseDate: body.releaseDate ? new Date(body.releaseDate) : null,
        status: body.status ?? "draft",
        packRulesJson: (normalised ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
    return reply.code(201).send({ set });
  });

  fastify.get("/api/v1/sets/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const set = await fastify.prisma.set.findFirstOrThrow({
      where: { id, tenantId },
      include: { _count: { select: { cards: true } } },
    });
    const { _count, ...rest } = set;
    return { set: { ...rest, cardCount: _count.cards } };
  });

  fastify.patch("/api/v1/sets/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.code !== undefined) data.code = body.code;
    if (body.description !== undefined) data.description = body.description;
    if (body.status !== undefined) data.status = body.status;
    if (body.releaseDate !== undefined) {
      data.releaseDate = body.releaseDate ? new Date(body.releaseDate) : null;
    }
    if (body.packRulesJson !== undefined) {
      const normalised = normalizePackRules(body.packRulesJson);
      data.packRulesJson = (normalised ?? {}) as unknown as Prisma.InputJsonValue;
    }
    if (body.blockId !== undefined) data.blockId = body.blockId;

    const result = await fastify.prisma.set.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const set = await fastify.prisma.set.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { set };
  });

  fastify.delete("/api/v1/sets/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.set.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
