/**
 * Tenant API key routes (sec 36.7).
 *
 * Endpoints:
 *   GET    /api/v1/keys              list keys for the active tenant
 *   POST   /api/v1/keys              create a key — returns plaintext ONCE
 *   POST   /api/v1/keys/:id/revoke   revoke a key (sets revokedAt)
 *   DELETE /api/v1/keys/:id          delete the row entirely
 *
 * Security model:
 *   - Plaintext token format: `tcgs_<32 random hex bytes>` (= 64 hex chars).
 *   - We store ONLY the sha256 hash. The plaintext is shown to the
 *     creator once on issuance and never again.
 *   - On every authenticated request, the auth plugin compares the
 *     incoming bearer's sha256 against `ApiKey.tokenHash`.
 *   - Scopes are simple strings ("cards:read", "assets:write"). Empty
 *     scope list means read-only across the public-safe endpoints.
 *
 * Audit: every create / revoke / delete writes an AuditLog row.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";

const idParam = z.object({ id: z.string().min(1) });

const createBody = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(80)).max(60).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const KEY_PREFIX = "tcgs_";
const KEY_BYTES = 32;

export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export default async function apiKeyRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/keys", async (request) => {
    const { tenantId } = requireTenant(request);
    const keys = await fastify.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      // Hash + plaintext are never returned. Surface the prefix so the
      // user can identify keys by their first chars.
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopesJson: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdBy: true,
        createdAt: true,
      },
    });
    return { keys };
  });

  fastify.post("/api/v1/keys", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const body = createBody.parse(request.body);

    const plaintext = `${KEY_PREFIX}${crypto.randomBytes(KEY_BYTES).toString("hex")}`;
    const tokenHash = hashToken(plaintext);
    const tokenPrefix = plaintext.slice(0, 12); // includes the `tcgs_` prefix

    const key = await fastify.prisma.apiKey.create({
      data: {
        tenantId,
        name: body.name,
        tokenHash,
        tokenPrefix,
        scopesJson: (body.scopes ?? []) as unknown as import("@prisma/client").Prisma.InputJsonValue,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdBy: user.id,
      },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopesJson: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "apikey.create",
      actorUserId: user.id,
      entityType: "apikey",
      entityId: key.id,
      metadata: { name: body.name, scopes: body.scopes ?? [] },
    });
    void dispatchWebhook(fastify.prisma, request.log, {
      tenantId,
      event: "apikey.create",
      data: { id: key.id, name: body.name, scopes: body.scopes ?? [] },
    });

    // Plaintext is returned ONCE, alongside the key row. The frontend
    // renders this in a "save this somewhere safe" panel and can never
    // retrieve it again.
    return reply.code(201).send({
      key,
      plaintext,
      curlExample: `curl -H "Authorization: Bearer ${plaintext}" https://api.tcgstudio.local/api/v1/cards`,
    });
  });

  fastify.post("/api/v1/keys/:id/revoke", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const result = await fastify.prisma.apiKey.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return reply.code(404).send({ error: "not_found_or_already_revoked" });
    }

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "apikey.revoke",
      actorUserId: user.id,
      entityType: "apikey",
      entityId: id,
    });

    const key = await fastify.prisma.apiKey.findFirstOrThrow({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopesJson: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return { key };
  });

  fastify.delete("/api/v1/keys/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const result = await fastify.prisma.apiKey.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "apikey.delete",
      actorUserId: user.id,
      entityType: "apikey",
      entityId: id,
    });

    return reply.code(204).send();
  });
}
