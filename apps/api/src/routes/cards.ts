/**
 * Card routes (sec 18).
 *
 * Cards live under a card type. Their `dataJson` keys are validated against
 * the card type's schemaJson — but for v0 the API is permissive (we store
 * whatever the client sends). The validation layer lands when we wire the
 * schema engine.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";

const idParam = z.object({ id: z.string().min(1) });

/**
 * Capture the current Card row as a CardVersion. Called BEFORE
 * applying a PATCH or restore so the previous state is preserved.
 *
 * Idempotent in the sense that calling it twice in a row produces
 * two snapshots — that's deliberate; if a route invokes this
 * unnecessarily the cost is one extra row, not data loss.
 *
 * `versionNum` is computed by counting existing snapshots; ordering
 * is per-card so concurrent updates to different cards don't
 * contend. Concurrent updates to the SAME card race; the unique
 * constraint will surface as a P2002 we retry-with-bumped-num via
 * the `attempts` loop.
 */
async function snapshotCard(
  prisma: PrismaClient,
  card: {
    id: string;
    tenantId: string;
    name: string;
    slug: string;
    status: string;
    rarity: string | null;
    collectorNumber: number | null;
    cardTypeId: string;
    setId: string | null;
    dataJson: Prisma.JsonValue;
  },
  actorUserId: string | null,
  note: string,
): Promise<{ versionNum: number }> {
  let attempts = 0;
  // Loop on unique-constraint races — at most a few times in practice.
  while (true) {
    const max = await prisma.cardVersion.aggregate({
      where: { cardId: card.id },
      _max: { versionNum: true },
    });
    const next = (max._max.versionNum ?? 0) + 1;
    try {
      await prisma.cardVersion.create({
        data: {
          tenantId: card.tenantId,
          cardId: card.id,
          versionNum: next,
          name: card.name,
          slug: card.slug,
          status: card.status,
          rarity: card.rarity,
          collectorNumber: card.collectorNumber,
          cardTypeId: card.cardTypeId,
          setId: card.setId,
          dataJson: card.dataJson as unknown as Prisma.InputJsonValue,
          note,
          createdBy: actorUserId,
        },
      });
      return { versionNum: next };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempts++ < 3
      ) {
        continue;
      }
      throw err;
    }
  }
}

/** Optional auth. Returns null when the request was made with an API
 *  key rather than a user JWT. */
function safeUserId(request: FastifyRequest): string | null {
  try {
    return requireUser(request).id;
  } catch {
    return null;
  }
}

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

const createBody = z.object({
  projectId: z.string().min(1),
  cardTypeId: z.string().min(1),
  name: z.string().min(1).max(180),
  slug: slugSchema,
  dataJson: z.record(z.string(), z.unknown()).optional(),
  rarity: z.string().max(40).optional(),
  collectorNumber: z.number().int().nonnegative().optional(),
  setId: z.string().min(1).nullable().optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(180).optional(),
  slug: slugSchema.optional(),
  dataJson: z.record(z.string(), z.unknown()).optional(),
  status: z
    .enum([
      "idea",
      "draft",
      "needs_review",
      "rules_review",
      "art_needed",
      "art_complete",
      "balance_testing",
      "approved",
      "released",
      "deprecated",
      "banned",
      "archived",
    ])
    .optional(),
  rarity: z.string().max(40).nullable().optional(),
  collectorNumber: z.number().int().nonnegative().nullable().optional(),
  /** Move a card into a set, or null to detach. */
  setId: z.string().min(1).nullable().optional(),
});

export default async function cardRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/cards", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = (request.query as Record<string, string>) ?? {};
    const cards = await fastify.prisma.card.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.cardTypeId ? { cardTypeId: q.cardTypeId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.setId ? { setId: q.setId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return { cards };
  });

  fastify.post("/api/v1/cards", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const cardType = await fastify.prisma.cardType.findFirst({
      where: { id: body.cardTypeId, tenantId, projectId: body.projectId },
      select: { id: true, projectId: true },
    });
    if (!cardType) {
      return reply.code(404).send({ error: "card_type_not_found" });
    }

    // If a set was requested, confirm it belongs to the same project + tenant.
    if (body.setId) {
      const set = await fastify.prisma.set.findFirst({
        where: { id: body.setId, tenantId, projectId: cardType.projectId },
        select: { id: true },
      });
      if (!set) return reply.code(404).send({ error: "set_not_found" });
    }

    const card = await fastify.prisma.card.create({
      data: {
        tenantId,
        projectId: cardType.projectId,
        cardTypeId: cardType.id,
        name: body.name,
        slug: body.slug,
        dataJson: (body.dataJson ?? {}) as unknown as Prisma.InputJsonValue,
        rarity: body.rarity ?? null,
        collectorNumber: body.collectorNumber ?? null,
        setId: body.setId ?? null,
      },
    });
    return reply.code(201).send({ card });
  });

  fastify.get("/api/v1/cards/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const card = await fastify.prisma.card.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { card };
  });

  fastify.patch("/api/v1/cards/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    // Read the current state first so we can snapshot it before the
    // update lands. Cheaper than a transactional version-then-update
    // because the snapshot is incidental to the user's flow — if the
    // app crashes between snapshot and update we end up with an extra
    // version row pointing at the same payload as the live record,
    // which is harmless.
    const before = await fastify.prisma.card.findFirst({
      where: { id, tenantId },
    });
    if (!before) return { error: "not_found" };

    // Skip snapshotting when the patch is a no-op (e.g. UI sends an
    // unchanged dataJson on every dirty save). Compare structurally
    // for the JSON path, scalars by equality.
    const noChange =
      (body.name === undefined || body.name === before.name) &&
      (body.slug === undefined || body.slug === before.slug) &&
      (body.status === undefined || body.status === before.status) &&
      (body.rarity === undefined || body.rarity === (before.rarity ?? null)) &&
      (body.collectorNumber === undefined ||
        body.collectorNumber === (before.collectorNumber ?? null)) &&
      (body.setId === undefined || body.setId === (before.setId ?? null)) &&
      (body.dataJson === undefined ||
        JSON.stringify(body.dataJson) === JSON.stringify(before.dataJson));

    if (!noChange) {
      await snapshotCard(
        fastify.prisma,
        before,
        safeUserId(request),
        "auto-snapshot before update",
      );
    }

    const data: Prisma.CardUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.dataJson !== undefined)
      data.dataJson = body.dataJson as unknown as Prisma.InputJsonValue;
    if (body.status !== undefined) data.status = body.status;
    if (body.rarity !== undefined) data.rarity = body.rarity;
    if (body.collectorNumber !== undefined) data.collectorNumber = body.collectorNumber;
    // Prisma's relation update needs `connect` / `disconnect`. We use the
    // bare scalar form here since this is `updateMany` (which DOES accept
    // raw scalar fk fields, unlike `update`).
    if (body.setId !== undefined) (data as { setId?: string | null }).setId = body.setId;

    const result = await fastify.prisma.card.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const card = await fastify.prisma.card.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { card };
  });

  // ---------------------------------------------------------------------------
  // Version history (sec 46)
  // ---------------------------------------------------------------------------

  /** List versions newest-first, capped at 200 so the UI can paginate
   *  later without us having to backfill. */
  fastify.get("/api/v1/cards/:id/versions", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const card = await fastify.prisma.card.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!card) return reply.code(404).send({ error: "not_found" });

    const versions = await fastify.prisma.cardVersion.findMany({
      where: { cardId: id, tenantId },
      orderBy: { versionNum: "desc" },
      take: 200,
    });
    return { versions };
  });

  /** Compare two versions — useful for the diff drawer in the UI.
   *  Both ids must belong to the same card under this tenant. */
  fastify.get(
    "/api/v1/cards/:id/versions/compare",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { id } = idParam.parse(request.params);
      const q = z
        .object({ a: z.string().min(1), b: z.string().min(1) })
        .parse(request.query);

      const [a, b] = await Promise.all([
        fastify.prisma.cardVersion.findFirst({
          where: { id: q.a, tenantId, cardId: id },
        }),
        fastify.prisma.cardVersion.findFirst({
          where: { id: q.b, tenantId, cardId: id },
        }),
      ]);
      if (!a || !b) return reply.code(404).send({ error: "version_not_found" });
      return { a, b };
    },
  );

  /** Restore the card to a previous version. Snapshots the current
   *  state first so the restore itself becomes undoable. */
  fastify.post(
    "/api/v1/cards/:id/versions/:versionId/restore",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { id, versionId } = z
        .object({ id: z.string().min(1), versionId: z.string().min(1) })
        .parse(request.params);

      const [card, target] = await Promise.all([
        fastify.prisma.card.findFirst({ where: { id, tenantId } }),
        fastify.prisma.cardVersion.findFirst({
          where: { id: versionId, cardId: id, tenantId },
        }),
      ]);
      if (!card) return reply.code(404).send({ error: "not_found" });
      if (!target)
        return reply.code(404).send({ error: "version_not_found" });

      const actor = safeUserId(request);

      // Snapshot the current state so the restore is reversible.
      await snapshotCard(
        fastify.prisma,
        card,
        actor,
        `auto-snapshot before restore to v${target.versionNum}`,
      );

      const restored = await fastify.prisma.card.update({
        where: { id },
        data: {
          name: target.name,
          slug: target.slug,
          status: target.status,
          rarity: target.rarity,
          collectorNumber: target.collectorNumber,
          cardTypeId: target.cardTypeId,
          setId: target.setId,
          dataJson: target.dataJson as unknown as Prisma.InputJsonValue,
        },
      });

      await writeAudit(fastify.prisma, request, {
        tenantId,
        action: "card.restore",
        actorUserId: actor,
        entityType: "card",
        entityId: id,
        metadata: { fromVersion: target.versionNum },
      });

      return { card: restored };
    },
  );

  fastify.delete("/api/v1/cards/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.card.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
