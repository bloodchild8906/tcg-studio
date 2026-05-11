/**
 * Card comments + approval workflow (sec 18.4).
 *
 * Two-in-one route file: standalone comments (review notes) and
 * approval-flow markers share a single `CardComment` table so the
 * timeline a designer reads is one chronological narrative rather
 * than a split between an audit log and a comment thread.
 *
 * Endpoints:
 *
 *   GET    /api/v1/cards/:id/comments
 *   POST   /api/v1/cards/:id/comments               body: { body, parentId?, versionId? }
 *   PATCH  /api/v1/cards/:id/comments/:commentId   body: { body? }
 *   POST   /api/v1/cards/:id/comments/:commentId/resolve
 *   POST   /api/v1/cards/:id/comments/:commentId/unresolve
 *   DELETE /api/v1/cards/:id/comments/:commentId
 *
 *   POST   /api/v1/cards/:id/approve                body: { comment? }
 *   POST   /api/v1/cards/:id/request-changes        body: { comment? }
 *
 * Notification fanout: when a non-author user comments / approves /
 * rejects, we ping every prior commenter so reviewers stay aware of
 * the thread. Self-comments don't ping anyone.
 *
 * Authoring: comments require a real authenticated user (JWT path).
 * API-key writes are blocked because comments are personal review
 * artefacts that need a human author for accountability.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";
import { channels, emit } from "@/plugins/realtime";

const cardParam = z.object({ id: z.string().min(1) });
const commentParams = z.object({
  id: z.string().min(1),
  commentId: z.string().min(1),
});

const createCommentBody = z.object({
  body: z.string().min(1).max(8000),
  parentId: z.string().nullable().optional(),
  versionId: z.string().nullable().optional(),
});

const patchCommentBody = z.object({
  body: z.string().min(1).max(8000),
});

const approvalBody = z.object({
  comment: z.string().max(4000).optional(),
});

/** Status the approval flow drives the card into. The card may have
 *  been in any prior state — we just stamp the canonical destination
 *  and rely on the audit log + comment to record the transition. */
const APPROVED_STATUS = "approved";
const CHANGES_STATUS = "needs_review";

export default async function cardCommentRoutes(fastify: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Comments — list / create / update / resolve / delete
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/cards/:id/comments", async (request, reply) => {
    const ctx = requireTenant(request);
    const { id } = cardParam.parse(request.params);

    const card = await fastify.prisma.card.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!card) return reply.code(404).send({ error: "card_not_found" });

    const comments = await fastify.prisma.cardComment.findMany({
      where: { cardId: id, tenantId: ctx.tenantId },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    return { comments };
  });

  fastify.post("/api/v1/cards/:id/comments", async (request, reply) => {
    const ctx = requireTenant(request);
    const user = requireUser(request);
    const { id } = cardParam.parse(request.params);
    const body = createCommentBody.parse(request.body);

    const card = await fastify.prisma.card.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, name: true },
    });
    if (!card) return reply.code(404).send({ error: "card_not_found" });

    // If a parent was supplied, verify it lives on the same card so a
    // malicious payload can't graft a comment from another card under
    // a different tenant.
    if (body.parentId) {
      const parent = await fastify.prisma.cardComment.findFirst({
        where: { id: body.parentId, cardId: id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!parent)
        return reply.code(404).send({ error: "parent_not_found" });
    }

    const comment = await fastify.prisma.cardComment.create({
      data: {
        tenantId: ctx.tenantId,
        cardId: id,
        userId: user.id,
        parentId: body.parentId ?? null,
        kind: "comment",
        body: body.body,
        versionId: body.versionId ?? null,
      },
    });

    await fanoutNotifications(fastify, {
      tenantId: ctx.tenantId,
      cardId: id,
      cardName: card.name,
      authorId: user.id,
      kind: "comment",
    });

    // Realtime push so other reviewers see the comment instantly.
    emit({
      channel: channels.card(ctx.tenantId, id),
      kind: "card.comment.created",
      payload: { comment },
    });

    return reply.code(201).send({ comment });
  });

  fastify.patch(
    "/api/v1/cards/:id/comments/:commentId",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id, commentId } = commentParams.parse(request.params);
      const body = patchCommentBody.parse(request.body);

      // Authors can edit their own comments; anyone else gets 403 even
      // if they have the comment id. The frontend hides the action for
      // non-authors, so this is a defense-in-depth check.
      const existing = await fastify.prisma.cardComment.findFirst({
        where: { id: commentId, cardId: id, tenantId: ctx.tenantId },
      });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      if (existing.userId !== user.id)
        return reply.code(403).send({ error: "forbidden" });

      const comment = await fastify.prisma.cardComment.update({
        where: { id: commentId },
        data: { body: body.body },
      });
      return { comment };
    },
  );

  fastify.post(
    "/api/v1/cards/:id/comments/:commentId/resolve",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id, commentId } = commentParams.parse(request.params);

      const result = await fastify.prisma.cardComment.updateMany({
        where: {
          id: commentId,
          cardId: id,
          tenantId: ctx.tenantId,
          resolvedAt: null,
        },
        data: { resolvedAt: new Date(), resolvedBy: user.id },
      });
      if (result.count === 0)
        return reply.code(404).send({ error: "not_found_or_already_resolved" });

      const comment = await fastify.prisma.cardComment.findFirstOrThrow({
        where: { id: commentId, tenantId: ctx.tenantId },
      });
      return { comment };
    },
  );

  fastify.post(
    "/api/v1/cards/:id/comments/:commentId/unresolve",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const { id, commentId } = commentParams.parse(request.params);

      const result = await fastify.prisma.cardComment.updateMany({
        where: { id: commentId, cardId: id, tenantId: ctx.tenantId },
        data: { resolvedAt: null, resolvedBy: null },
      });
      if (result.count === 0)
        return reply.code(404).send({ error: "not_found" });

      const comment = await fastify.prisma.cardComment.findFirstOrThrow({
        where: { id: commentId, tenantId: ctx.tenantId },
      });
      return { comment };
    },
  );

  fastify.delete(
    "/api/v1/cards/:id/comments/:commentId",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id, commentId } = commentParams.parse(request.params);

      const existing = await fastify.prisma.cardComment.findFirst({
        where: { id: commentId, cardId: id, tenantId: ctx.tenantId },
      });
      if (!existing) return reply.code(404).send({ error: "not_found" });

      // Only the author can delete their own comment for v0. A
      // tenant-admin override hooks in here later when we wire fine
      // grained card-comment permissions.
      if (existing.userId !== user.id)
        return reply.code(403).send({ error: "forbidden" });

      await fastify.prisma.cardComment.delete({ where: { id: commentId } });
      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // Approval flow — bumps card status + writes a marker comment
  // -------------------------------------------------------------------------

  fastify.post("/api/v1/cards/:id/approve", async (request, reply) => {
    return runApproval(fastify, request, reply, "approval", APPROVED_STATUS);
  });

  fastify.post(
    "/api/v1/cards/:id/request-changes",
    async (request, reply) => {
      return runApproval(
        fastify,
        request,
        reply,
        "change_request",
        CHANGES_STATUS,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runApproval(
  fastify: FastifyInstance,
  request: Parameters<Parameters<FastifyInstance["post"]>[1]>[0],
  reply: Parameters<Parameters<FastifyInstance["post"]>[1]>[1],
  kind: "approval" | "change_request",
  destinationStatus: string,
) {
  const ctx = requireTenant(request);
  const user = requireUser(request);
  const { id } = cardParam.parse(request.params);
  const body = approvalBody.parse(request.body ?? {});

  const card = await fastify.prisma.card.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, name: true, status: true },
  });
  if (!card) return reply.code(404).send({ error: "card_not_found" });

  // Bump status — even if the card is already approved we still
  // record a comment, since "I confirm this is good" is itself a
  // signal worth keeping in the timeline.
  if (card.status !== destinationStatus) {
    await fastify.prisma.card.update({
      where: { id },
      data: { status: destinationStatus },
    });
  }

  const note = (body.comment ?? "").trim();
  const fallback =
    kind === "approval"
      ? `Approved by reviewer.`
      : `Changes requested.`;

  const comment = await fastify.prisma.cardComment.create({
    data: {
      tenantId: ctx.tenantId,
      cardId: id,
      userId: user.id,
      kind,
      body: note || fallback,
    },
  });

  await writeAudit(fastify.prisma, request, {
    tenantId: ctx.tenantId,
    action: kind === "approval" ? "card.approve" : "card.request_changes",
    actorUserId: user.id,
    entityType: "card",
    entityId: id,
    metadata: {
      fromStatus: card.status,
      toStatus: destinationStatus,
    },
  });

  await fanoutNotifications(fastify, {
    tenantId: ctx.tenantId,
    cardId: id,
    cardName: card.name,
    authorId: user.id,
    kind,
  });

  const updated = await fastify.prisma.card.findFirstOrThrow({
    where: { id, tenantId: ctx.tenantId },
  });

  // Realtime fanout — the same channel comments push on, so the
  // review drawer collapses approval markers and comments into one
  // live feed.
  emit({
    channel: channels.card(ctx.tenantId, id),
    kind:
      kind === "approval" ? "card.approved" : "card.changes_requested",
    payload: { card: updated, comment },
  });

  return reply.code(201).send({ card: updated, comment });
}

/**
 * Notify everyone who has commented on the card before, plus the
 * card's project members in a future iteration. We keep the fanout
 * O(distinct prior commenters) so a hot card thread doesn't spam.
 */
async function fanoutNotifications(
  fastify: FastifyInstance,
  args: {
    tenantId: string;
    cardId: string;
    cardName: string;
    authorId: string;
    kind: "comment" | "approval" | "change_request";
  },
) {
  const distinct = await fastify.prisma.cardComment.findMany({
    where: { cardId: args.cardId, tenantId: args.tenantId },
    select: { userId: true },
    distinct: ["userId"],
    take: 200,
  });
  const recipients = new Set(distinct.map((d) => d.userId));
  recipients.delete(args.authorId);
  if (recipients.size === 0) return;

  const title =
    args.kind === "comment"
      ? `New comment on "${args.cardName}"`
      : args.kind === "approval"
        ? `"${args.cardName}" was approved`
        : `Changes requested on "${args.cardName}"`;

  const rows = Array.from(recipients).map((userId) => ({
    userId,
    tenantId: args.tenantId,
    kind: `card.${args.kind}`,
    title,
    link: `/admin/cards/${args.cardId}`,
  }));
  await fastify.prisma.notification.createMany({ data: rows });

  // Push each notification on the recipient's personal channel.
  // Subscribers see the new row without re-polling.
  for (const row of rows) {
    emit({
      channel: channels.user(args.tenantId, row.userId),
      kind: "notification.created",
      payload: { notification: row },
    });
  }
}
