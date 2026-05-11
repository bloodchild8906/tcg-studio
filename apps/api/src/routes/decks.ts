/**
 * Deck routes (sec 30 + sec 27).
 *
 * Decks live at the project level and reference cards by id. Two
 * resources are exposed:
 *
 *   /api/v1/decks           — Deck CRUD (no card list embedded)
 *   /api/v1/decks/:id       — Deck with embedded `cards: DeckCard[]`
 *   /api/v1/decks/:id/cards — bulk replace the deck's cards in a single
 *                             transaction; the typical UX is "edit the
 *                             whole list at once" so we don't bother
 *                             with per-row PATCH/DELETE endpoints yet.
 *
 * Bulk replace transactionally: drop everything in DeckCard for this
 * deck, re-insert the new list. Cheaper than diffing on the server,
 * and the deck size is small enough (< 200 cards usually) that this
 * runs in single-digit ms.
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

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(4000).optional(),
  format: z.string().max(40).optional(),
  factionId: z.string().min(1).nullable().optional(),
  setId: z.string().min(1).nullable().optional(),
  coverAssetId: z.string().min(1).nullable().optional(),
  status: z
    .enum(["draft", "testing", "locked", "published", "archived"])
    .optional(),
  visibility: z
    .enum(["private", "tenant_internal", "project_internal", "public"])
    .optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

const deckCardSchema = z.object({
  cardId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  sideboard: z.boolean().optional(),
  category: z.string().max(40).optional(),
});

const replaceCardsBody = z.object({
  cards: z.array(deckCardSchema).max(500),
});

export default async function deckRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/decks", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = request.query as Record<string, string>;
    const decks = await fastify.prisma.deck.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.factionId ? { factionId: q.factionId } : {}),
        ...(q.setId ? { setId: q.setId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { cards: true } } },
    });
    return {
      decks: decks.map(({ _count, ...d }) => ({ ...d, cardCount: _count.cards })),
    };
  });

  fastify.post("/api/v1/decks", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);
    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const deck = await fastify.prisma.deck.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        format: body.format ?? "constructed",
        factionId: body.factionId ?? null,
        setId: body.setId ?? null,
        coverAssetId: body.coverAssetId ?? null,
        status: body.status ?? "draft",
        visibility: body.visibility ?? "private",
        metadataJson: (body.metadataJson ?? {}) as unknown as Prisma.InputJsonValue,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ deck });
  });

  fastify.get("/api/v1/decks/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const deck = await fastify.prisma.deck.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        cards: {
          // Include the underlying card name + slug + rarity so the deck
          // editor can render full rows without a second fetch.
          include: {
            card: {
              select: {
                id: true,
                name: true,
                slug: true,
                rarity: true,
                cardTypeId: true,
                setId: true,
                dataJson: true,
              },
            },
          },
          orderBy: [{ sideboard: "asc" }, { category: "asc" }],
        },
      },
    });
    return { deck };
  });

  fastify.patch("/api/v1/decks/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.DeckUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.format !== undefined) data.format = body.format;
    if (body.factionId !== undefined) data.factionId = body.factionId;
    if (body.setId !== undefined) data.setId = body.setId;
    if (body.coverAssetId !== undefined) data.coverAssetId = body.coverAssetId;
    if (body.status !== undefined) data.status = body.status;
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.metadataJson !== undefined) {
      data.metadataJson = body.metadataJson as unknown as Prisma.InputJsonValue;
    }
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.deck.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const deck = await fastify.prisma.deck.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { deck };
  });

  fastify.delete("/api/v1/decks/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.deck.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /**
   * Bulk replace the deck's card list. Idempotent — wipe + reinsert,
   * deduped by (deckId, cardId, sideboard) which is the unique index.
   * Card ids are validated to belong to the same tenant before insert.
   */
  fastify.put("/api/v1/decks/:id/cards", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = replaceCardsBody.parse(request.body);

    const deck = await fastify.prisma.deck.findFirst({
      where: { id, tenantId },
      select: { id: true, projectId: true },
    });
    if (!deck) return reply.code(404).send({ error: "not_found" });

    // Validate every card id exists in this tenant's project. We only
    // need the count match — fewer DB round-trips than per-card lookups.
    const cardIds = Array.from(new Set(body.cards.map((c) => c.cardId)));
    const validCards = await fastify.prisma.card.count({
      where: {
        tenantId,
        projectId: deck.projectId,
        id: { in: cardIds },
      },
    });
    if (validCards !== cardIds.length) {
      return reply.code(400).send({ error: "invalid_card_id" });
    }

    await fastify.prisma.$transaction([
      fastify.prisma.deckCard.deleteMany({ where: { deckId: id } }),
      fastify.prisma.deckCard.createMany({
        data: body.cards.map((c) => ({
          deckId: id,
          cardId: c.cardId,
          quantity: c.quantity,
          sideboard: c.sideboard ?? false,
          category: c.category ?? "",
        })),
        skipDuplicates: true,
      }),
    ]);

    return { ok: true, count: body.cards.length };
  });
}
