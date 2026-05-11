/**
 * Playtest session relay (sec 30 + 37.2).
 *
 * v0 is a *relay*, not an authoritative game server. Each client
 * runs the same playtest engine locally and applies every action
 * optimistically; this route just forwards each action to every
 * other client subscribed to the session's WS channel.
 *
 * Why a relay first:
 *
 *   • The engine is intentionally generic — it has to support every
 *     custom ruleset a tenant invents, so server-side authoritative
 *     resolution would mean shipping a full WASM/V8 sandbox.
 *   • Two-player remote playtest is the common ask; a relay lets
 *     players test together over the internet today.
 *   • The path to authoritative is "swap the relay for a state
 *     machine" — the wire format here is the same actions the
 *     authoritative server would consume.
 *
 * Endpoints:
 *
 *   POST /api/v1/playtest/sessions
 *     { boardId?, rulesetId?, code? } -> { sessionId, joinCode }
 *
 *   POST /api/v1/playtest/sessions/:id/relay
 *     { action } -> 204
 *
 *   POST /api/v1/playtest/sessions/:id/presence
 *     { name, seat? } -> 204
 *
 * Sessions live in memory. Restart the API and active sessions
 * vanish — players just create a new code. A persisted variant
 * lives behind a future flag.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { channels, emit } from "@/plugins/realtime";

interface PlaytestSession {
  id: string;
  /** Short human-friendly join code (e.g. "K7F2X"). */
  code: string;
  tenantId: string;
  /** Author user id. */
  ownerId: string;
  boardId: string | null;
  rulesetId: string | null;
  createdAt: number;
  /** Last seen activity — sessions idle for > 24h get reaped. */
  touchedAt: number;
}

const sessions = new Map<string, PlaytestSession>();
const codeIndex = new Map<string, string>(); // code → sessionId

const REAP_AFTER_MS = 24 * 60 * 60 * 1000;

/** Reap idle sessions every hour. Cheap — sessions are tiny. */
setInterval(() => {
  const cutoff = Date.now() - REAP_AFTER_MS;
  for (const [id, s] of sessions) {
    if (s.touchedAt < cutoff) {
      sessions.delete(id);
      codeIndex.delete(s.code);
    }
  }
}, 60 * 60 * 1000).unref?.();

const createBody = z.object({
  boardId: z.string().nullable().optional(),
  rulesetId: z.string().nullable().optional(),
  /** Optional caller-chosen code (for invitations). 5–8 chars. */
  code: z
    .string()
    .min(5)
    .max(8)
    .regex(/^[A-Z0-9]+$/)
    .optional(),
});

const relayBody = z.object({
  action: z.record(z.unknown()),
  /** Monotonic sequence so peers can ignore stale frames. */
  seq: z.number().int().nonnegative().optional(),
});

const presenceBody = z.object({
  displayName: z.string().min(1).max(80),
  seat: z.number().int().min(0).max(8).optional(),
});

const idParam = z.object({ id: z.string().min(1) });

function genCode() {
  // 5-char Crockford-style code — avoids the visually ambiguous
  // letters (I/L/O/0/1).
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

export default async function playtestRoutes(fastify: FastifyInstance) {
  /** Create a session. Returns its WS channel name + a join code
   *  so a teammate can connect by typing the code instead of a
   *  full uuid. */
  fastify.post("/api/v1/playtest/sessions", async (request, reply) => {
    const ctx = requireTenant(request);
    const user = requireUser(request);
    const body = createBody.parse(request.body ?? {});

    let code = body.code ?? genCode();
    let attempt = 0;
    while (codeIndex.has(code) && attempt < 5) {
      code = genCode();
      attempt += 1;
    }
    if (codeIndex.has(code)) {
      return reply.code(409).send({ error: "code_taken" });
    }

    const id = crypto.randomUUID();
    const session: PlaytestSession = {
      id,
      code,
      tenantId: ctx.tenantId,
      ownerId: user.id,
      boardId: body.boardId ?? null,
      rulesetId: body.rulesetId ?? null,
      createdAt: Date.now(),
      touchedAt: Date.now(),
    };
    sessions.set(id, session);
    codeIndex.set(code, id);

    return reply.code(201).send({
      session,
      channel: `tenant:${ctx.tenantId}:playtest:${id}`,
    });
  });

  /** Look up a session by code — used by the join flow. */
  fastify.get("/api/v1/playtest/sessions/by-code/:code", async (request, reply) => {
    const ctx = requireTenant(request);
    const code = (request.params as { code?: string }).code?.toUpperCase();
    if (!code) return reply.code(400).send({ error: "missing_code" });
    const id = codeIndex.get(code);
    if (!id) return reply.code(404).send({ error: "not_found" });
    const session = sessions.get(id);
    if (!session || session.tenantId !== ctx.tenantId) {
      return reply.code(404).send({ error: "not_found" });
    }
    return {
      session,
      channel: `tenant:${ctx.tenantId}:playtest:${id}`,
    };
  });

  /** Forward an action to every other client subscribed to the
   *  session channel. The sender's own client doesn't apply the
   *  echo (engine actions are deterministic when run locally — we
   *  just don't double-apply when the server bounces the message
   *  back to the originator). */
  fastify.post(
    "/api/v1/playtest/sessions/:id/relay",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);
      const body = relayBody.parse(request.body);

      const session = sessions.get(id);
      if (!session || session.tenantId !== ctx.tenantId) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      session.touchedAt = Date.now();

      emit({
        channel: channels.playtest(ctx.tenantId, id),
        kind: "playtest.action",
        payload: {
          sessionId: id,
          action: body.action,
          seq: body.seq ?? null,
          actorId: user.id,
        },
      });
      return reply.code(204).send();
    },
  );

  /** Announce presence — name + chosen seat. Other peers add the
   *  player to their roster on receipt. */
  fastify.post(
    "/api/v1/playtest/sessions/:id/presence",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);
      const body = presenceBody.parse(request.body);

      const session = sessions.get(id);
      if (!session || session.tenantId !== ctx.tenantId) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      session.touchedAt = Date.now();

      emit({
        channel: channels.playtest(ctx.tenantId, id),
        kind: "playtest.presence",
        payload: {
          sessionId: id,
          userId: user.id,
          displayName: body.displayName,
          seat: body.seat ?? null,
          ts: Date.now(),
        },
      });
      return reply.code(204).send();
    },
  );

  /** Manual close — owner ends the session. Other peers receive a
   *  `playtest.closed` event and tear down. */
  fastify.post(
    "/api/v1/playtest/sessions/:id/close",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);

      const session = sessions.get(id);
      if (!session || session.tenantId !== ctx.tenantId) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (session.ownerId !== user.id) {
        return reply.code(403).send({ error: "not_owner" });
      }

      emit({
        channel: channels.playtest(ctx.tenantId, id),
        kind: "playtest.closed",
        payload: { sessionId: id, by: user.id },
      });
      sessions.delete(id);
      codeIndex.delete(session.code);
      return reply.code(204).send();
    },
  );
}
