/**
 * Inline images — profile avatars + tenant whitelabel logos stored
 * directly in postgres as `BYTEA` columns. Reserves the MinIO/GCS asset
 * library for content the operator manages day-to-day (card art, CMS
 * media, downloads); brand bits are one-time uploads that don't deserve
 * a full Asset row + object-storage object + lifecycle tracking.
 *
 * Endpoints (mounted at root, not inside the tenant block — these need
 * to be reachable without a tenant header because the public CMS site
 * hits the tenant logos for unauthenticated visitors):
 *
 *   GET    /api/v1/users/:userId/avatar
 *   PUT    /api/v1/users/me/avatar              (multipart, max 256 KB)
 *   DELETE /api/v1/users/me/avatar
 *
 *   GET    /api/v1/public/:tenantSlug/branding/logo
 *   GET    /api/v1/public/:tenantSlug/branding/icon
 *   GET    /api/v1/public/:tenantSlug/branding/favicon
 *   PUT    /api/v1/tenants/:tenantId/branding/:kind  (multipart, max 512 KB)
 *   DELETE /api/v1/tenants/:tenantId/branding/:kind
 *
 * Why GET is public: the platform header / CMS header renders the logo
 * for every visitor including not-yet-signed-in ones. Putting auth on
 * the read path would make the public site flicker through a broken-
 * image state during page load.
 *
 * Caching: serves with a long `Cache-Control: public, max-age=86400`
 * and a per-row `ETag` (a hash of the byte content) so the browser
 * round-trips a 304 on subsequent loads. When the operator uploads a
 * new image, the ETag changes and the cache is busted automatically.
 */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

const MAX_AVATAR_BYTES = 256 * 1024; // 256 KB — overkill for an avatar
const MAX_BRAND_BYTES = 512 * 1024; // 512 KB — logo/icon/favicon
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

type BrandKind = "logo" | "icon" | "favicon";

function brandColumns(kind: BrandKind): { img: string; mime: string } {
  if (kind === "logo") return { img: "logoImage", mime: "logoMimeType" };
  if (kind === "icon") return { img: "iconImage", mime: "iconMimeType" };
  return { img: "faviconImage", mime: "faviconMimeType" };
}

function etagFor(buf: Buffer): string {
  return `"${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16)}"`;
}

export default async function inlineImageRoutes(fastify: FastifyInstance) {
  // ── User avatar ──────────────────────────────────────────────────

  fastify.get<{ Params: { userId: string } }>(
    "/api/v1/users/:userId/avatar",
    async (request, reply) => {
      const row = await fastify.prisma.user.findUnique({
        where: { id: request.params.userId },
        select: { avatarImage: true, avatarMimeType: true },
      });
      if (!row?.avatarImage) return reply.code(404).send({ error: "no avatar" });
      const buf = Buffer.from(row.avatarImage);
      const etag = etagFor(buf);
      if (request.headers["if-none-match"] === etag) {
        return reply.code(304).send();
      }
      reply.header("Content-Type", row.avatarMimeType ?? "application/octet-stream");
      reply.header("Cache-Control", "public, max-age=86400");
      reply.header("ETag", etag);
      return reply.send(buf);
    },
  );

  fastify.put("/api/v1/users/me/avatar", async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "auth required" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "file required" });
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return reply.code(415).send({ error: `unsupported mime: ${file.mimetype}` });
    }
    const buf = await file.toBuffer();
    if (buf.byteLength > MAX_AVATAR_BYTES) {
      return reply
        .code(413)
        .send({ error: `avatar > ${MAX_AVATAR_BYTES} bytes (got ${buf.byteLength})` });
    }
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { avatarImage: buf, avatarMimeType: file.mimetype },
    });
    return reply.send({ ok: true, bytes: buf.byteLength, mime: file.mimetype });
  });

  fastify.delete("/api/v1/users/me/avatar", async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "auth required" });
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: { avatarImage: null, avatarMimeType: null },
    });
    return reply.send({ ok: true });
  });

  // ── Tenant branding ──────────────────────────────────────────────

  for (const kind of ["logo", "icon", "favicon"] as const) {
    fastify.get<{ Params: { tenantSlug: string } }>(
      `/api/v1/public/:tenantSlug/branding/${kind}`,
      async (request, reply) => {
        const cols = brandColumns(kind);
        const row = await fastify.prisma.tenant.findUnique({
          where: { slug: request.params.tenantSlug },
          select: { [cols.img]: true, [cols.mime]: true } as never,
        });
        const r = row as unknown as Record<string, unknown> | null;
        const img = r?.[cols.img] as Uint8Array | null | undefined;
        const mime = r?.[cols.mime] as string | null | undefined;
        if (!img) return reply.code(404).send({ error: `no ${kind}` });
        const buf = Buffer.from(img);
        const etag = etagFor(buf);
        if (request.headers["if-none-match"] === etag) return reply.code(304).send();
        reply.header("Content-Type", mime ?? "application/octet-stream");
        reply.header("Cache-Control", "public, max-age=86400");
        reply.header("ETag", etag);
        return reply.send(buf);
      },
    );
  }

  fastify.put<{ Params: { tenantId: string; kind: BrandKind } }>(
    "/api/v1/tenants/:tenantId/branding/:kind",
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "auth required" });
      const { tenantId, kind } = request.params;
      if (!["logo", "icon", "favicon"].includes(kind)) {
        return reply.code(400).send({ error: `unknown brand kind: ${kind}` });
      }
      // Authorize — caller must be a tenant_owner / tenant_admin of this
      // tenant, OR a platform admin. Same check the existing tenant
      // branding endpoint uses (see routes/tenants.ts).
      const allowed = await fastify.prisma.membership.findFirst({
        where: {
          tenantId,
          userId: user.id,
          role: { in: ["tenant_owner", "tenant_admin"] },
        },
        select: { id: true },
      });
      const isPlatformAdmin =
        user.platformRole === "owner" || user.platformRole === "admin";
      if (!allowed && !isPlatformAdmin) {
        return reply.code(403).send({ error: "not allowed" });
      }

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "file required" });
      if (!ALLOWED_MIMES.has(file.mimetype)) {
        return reply
          .code(415)
          .send({ error: `unsupported mime: ${file.mimetype}` });
      }
      const buf = await file.toBuffer();
      if (buf.byteLength > MAX_BRAND_BYTES) {
        return reply
          .code(413)
          .send({ error: `${kind} > ${MAX_BRAND_BYTES} bytes (got ${buf.byteLength})` });
      }
      const cols = brandColumns(kind);
      await fastify.prisma.tenant.update({
        where: { id: tenantId },
        data: { [cols.img]: buf, [cols.mime]: file.mimetype } as never,
      });
      return reply.send({
        ok: true,
        kind,
        bytes: buf.byteLength,
        mime: file.mimetype,
      });
    },
  );

  fastify.delete<{ Params: { tenantId: string; kind: BrandKind } }>(
    "/api/v1/tenants/:tenantId/branding/:kind",
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "auth required" });
      const { tenantId, kind } = request.params;
      if (!["logo", "icon", "favicon"].includes(kind)) {
        return reply.code(400).send({ error: `unknown brand kind: ${kind}` });
      }
      const allowed = await fastify.prisma.membership.findFirst({
        where: {
          tenantId,
          userId: user.id,
          role: { in: ["tenant_owner", "tenant_admin"] },
        },
        select: { id: true },
      });
      const isPlatformAdmin =
        user.platformRole === "owner" || user.platformRole === "admin";
      if (!allowed && !isPlatformAdmin) {
        return reply.code(403).send({ error: "not allowed" });
      }
      const cols = brandColumns(kind);
      await fastify.prisma.tenant.update({
        where: { id: tenantId },
        data: { [cols.img]: null, [cols.mime]: null } as never,
      });
      return reply.send({ ok: true, kind });
    },
  );
}
