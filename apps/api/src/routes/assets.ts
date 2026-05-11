/**
 * Asset routes (sec 20).
 *
 * Endpoints:
 *   GET    /api/v1/assets?projectId=...        list assets in tenant (optionally
 *                                              filtered to one project)
 *   POST   /api/v1/assets/upload               multipart file → MinIO + Asset row.
 *                                              Form fields: file (required),
 *                                              projectId, name, type
 *   GET    /api/v1/assets/:id                  asset metadata
 *   GET    /api/v1/assets/:id/blob             stream the file (with content-type
 *                                              and a long-cache header — assets
 *                                              are immutable, identified by id)
 *   DELETE /api/v1/assets/:id                  remove DB row + MinIO object
 *
 * Storage layout — matches sec 43.2:
 *   tenants/<tenantId>/projects/<projectId>/assets/<assetId>.<ext>
 *   tenants/<tenantId>/assets/<assetId>.<ext>   (when projectId is null)
 *
 * v0 caveats:
 *   - No image dimension probing (we'd add `image-size` for that). Width/height
 *     stay null until we do.
 *   - No virus scanning (sec 49.2 calls for it later).
 *   - No SVG sanitization — accept SVGs at your own risk for now.
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  projectId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  /// Filter by folder. `null` (literal string in URL) → only root-level
  /// assets. Omitted → assets across all folders.
  folderId: z
    .union([z.string().min(1), z.literal("null")])
    .optional(),
  /// Filter by approval status — usually `approved` from card/template
  /// renderers, omitted in the asset library so authors see their own
  /// drafts and pending uploads.
  status: z.enum(["draft", "pending", "approved", "rejected"]).optional(),
  /// Free-text name match. Case-insensitive.
  q: z.string().min(1).max(120).optional(),
  /// Cursor pagination: ISO timestamp; we return rows older than this.
  before: z.string().optional(),
  /// Page size. Capped at 5000 — large enough for most tenants but
  /// still bounded to keep memory predictable. Defaults to 1000 (was 500
  /// before; raised so libraries with many uploaded sprites don't get
  /// truncated by surprise).
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

const patchAssetBody = z.object({
  name: z.string().min(1).max(180).optional(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  type: z.string().min(1).max(40).optional(),
  visibility: z
    .enum(["private", "tenant_internal", "project_internal", "public"])
    .optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
  /// Move the asset into another folder. `null` = root.
  folderId: z.string().min(1).nullable().optional(),
});

const bulkBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  /// move | delete | submit | approve | reject | tag
  action: z.enum([
    "move",
    "delete",
    "submit",
    "approve",
    "reject",
    "set_visibility",
  ]),
  /// move target folder (`null` = root). Required when action="move".
  folderId: z.string().min(1).nullable().optional(),
  /// reviewer note. Optional but encouraged on reject.
  note: z.string().max(2000).optional(),
  /// visibility target. Required when action="set_visibility".
  visibility: z
    .enum(["private", "tenant_internal", "project_internal", "public"])
    .optional(),
});

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/gif",
]);

const MAX_BYTES = 100 * 1024 * 1024; // 100 MiB — covers spritesheets and high-res print art.

function extensionFor(mime: string, filename: string): string {
  // Trust the filename's extension first, since browsers occasionally lie
  // about jpeg vs jpg.
  const dot = filename.lastIndexOf(".");
  if (dot !== -1) return filename.slice(dot + 1).toLowerCase();
  // Fallback: derive from mime.
  return (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/avif": "avif",
      "image/gif": "gif",
    }[mime] ?? "bin"
  );
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "asset"
  );
}

export default async function assetRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/assets", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = listQuery.parse(request.query ?? {});
    const limit = q.limit ?? 1000;
    const before = q.before ? new Date(q.before) : undefined;
    const assets = await fastify.prisma.asset.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.folderId === "null"
          ? { folderId: null }
          : q.folderId
            ? { folderId: q.folderId }
            : {}),
        ...(q.q
          ? { name: { contains: q.q, mode: "insensitive" as const } }
          : {}),
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    // Surface a continuation cursor so the client can paginate without
    // page numbers. Empty when we returned fewer than `limit` rows.
    const nextBefore =
      assets.length === limit ? assets[assets.length - 1].createdAt : null;
    return { assets, nextBefore };
  });

  /**
   * Stream the underlying object back to the browser. We always proxy
   * (rather than handing out presigned URLs) so:
   *   - the browser doesn't need to know MinIO's host
   *   - we can run permission checks on every request
   *   - CORS is automatic (the API already allows the designer origin)
   *
   * Cached aggressively because asset files are immutable — the assetId is
   * regenerated on upload, so the URL always points at fresh content.
   */
  fastify.get("/api/v1/assets/:id/blob", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const asset = await fastify.prisma.asset.findFirst({
      where: { id, tenantId },
    });
    if (!asset) {
      return reply.code(404).send({ error: "not_found" });
    }

    try {
      const stream = await fastify.storage.client.getObject(
        fastify.storage.bucket,
        asset.storageKey,
      );
      reply
        .type(asset.mimeType)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Content-Length", String(asset.fileSize));
      return reply.send(stream);
    } catch (err) {
      request.log.warn({ err, key: asset.storageKey }, "asset blob fetch failed");
      return reply.code(502).send({ error: "storage_unavailable" });
    }
  });

  fastify.get("/api/v1/assets/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const asset = await fastify.prisma.asset.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { asset };
  });

  // PATCH — partial update. The blob is immutable (re-upload to change it),
  // so this only touches metadata fields.
  fastify.patch("/api/v1/assets/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchAssetBody.parse(request.body);

    const data: Prisma.AssetUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.type !== undefined) data.type = body.type;
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.metadataJson !== undefined) {
      data.metadataJson = body.metadataJson as unknown as Prisma.InputJsonValue;
    }
    if (body.folderId !== undefined) {
      // Validate the target folder belongs to the same tenant before
      // moving — the FK alone would catch tenant mismatches but we
      // want a friendlier 404 than a 500.
      if (body.folderId !== null) {
        const f = await fastify.prisma.assetFolder.findFirst({
          where: { id: body.folderId, tenantId },
          select: { id: true },
        });
        if (!f) return reply.code(404).send({ error: "folder_not_found" });
      }
      data.folder = body.folderId
        ? { connect: { id: body.folderId } }
        : { disconnect: true };
    }

    const result = await fastify.prisma.asset.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const asset = await fastify.prisma.asset.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { asset };
  });

  /**
   * Bulk operations across many assets in one request. The frontend
   * file-explorer uses this for multi-select actions: drag-to-folder,
   * delete-selection, submit-for-approval, approve, reject, mark
   * visibility. All checks happen server-side; we never trust a
   * client-supplied tenantId.
   *
   * Failures are reported per-id so the UI can show partial-success
   * feedback (e.g. 47 of 50 moved; 3 failed because they were already
   * deleted). The endpoint always returns 200 with a `{ succeeded,
   * failed }` shape.
   */
  fastify.post("/api/v1/assets/bulk", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = bulkBody.parse(request.body);

    // Pre-validate move target so we don't try to move 500 assets
    // and discover the folder is bogus on the last one.
    if (body.action === "move" && body.folderId != null) {
      const f = await fastify.prisma.assetFolder.findFirst({
        where: { id: body.folderId, tenantId },
        select: { id: true },
      });
      if (!f) return reply.code(404).send({ error: "folder_not_found" });
    }

    const userId = request.currentUser?.id ?? null;
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of body.ids) {
      const asset = await fastify.prisma.asset.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!asset) {
        failed.push({ id, reason: "not_found" });
        continue;
      }
      try {
        switch (body.action) {
          case "move": {
            await fastify.prisma.asset.update({
              where: { id },
              data: {
                folder: body.folderId
                  ? { connect: { id: body.folderId } }
                  : { disconnect: true },
              },
            });
            break;
          }
          case "delete": {
            await fastify.prisma.asset.delete({ where: { id } });
            break;
          }
          case "submit": {
            await fastify.prisma.asset.update({
              where: { id },
              data: { status: "pending", approvalNote: body.note ?? "" },
            });
            break;
          }
          case "approve": {
            await fastify.prisma.asset.update({
              where: { id },
              data: {
                status: "approved",
                approvalNote: body.note ?? "",
                approvedBy: userId,
                approvedAt: new Date(),
              },
            });
            break;
          }
          case "reject": {
            await fastify.prisma.asset.update({
              where: { id },
              data: {
                status: "rejected",
                approvalNote: body.note ?? "",
                approvedBy: userId,
                approvedAt: new Date(),
              },
            });
            break;
          }
          case "set_visibility": {
            if (!body.visibility) {
              failed.push({ id, reason: "missing_visibility" });
              continue;
            }
            await fastify.prisma.asset.update({
              where: { id },
              data: { visibility: body.visibility },
            });
            break;
          }
        }
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    return reply.send({ succeeded, failed });
  });

  /**
   * Submit a single asset for approval. Convenience wrapper around the
   * bulk path for the common one-off case in the asset detail panel.
   */
  fastify.post("/api/v1/assets/:id/submit", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const note = (request.body as { note?: string } | undefined)?.note ?? "";
    const result = await fastify.prisma.asset.updateMany({
      where: { id, tenantId },
      data: { status: "pending", approvalNote: note },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });

  fastify.post("/api/v1/assets/:id/approve", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const note = (request.body as { note?: string } | undefined)?.note ?? "";
    const userId = request.currentUser?.id ?? null;
    const result = await fastify.prisma.asset.updateMany({
      where: { id, tenantId },
      data: {
        status: "approved",
        approvalNote: note,
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });

  fastify.post("/api/v1/assets/:id/reject", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const note = (request.body as { note?: string } | undefined)?.note ?? "";
    const userId = request.currentUser?.id ?? null;
    const result = await fastify.prisma.asset.updateMany({
      where: { id, tenantId },
      data: {
        status: "rejected",
        approvalNote: note,
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });

  fastify.post("/api/v1/assets/upload", async (request, reply) => {
    const { tenantId } = requireTenant(request);

    // @fastify/multipart is registered globally — `request.file()` returns
    // the first file part on multipart/form-data requests.
    const part = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!part) {
      return reply.code(400).send({
        error: "bad_request",
        message: "Expected multipart/form-data with a 'file' field.",
      });
    }

    if (!ALLOWED_MIME.has(part.mimetype)) {
      return reply.code(415).send({
        error: "unsupported_media_type",
        message: `Mime '${part.mimetype}' not allowed. Allowed: ${[...ALLOWED_MIME].join(", ")}`,
      });
    }

    // Buffer the upload. For v0 sizes (<= 25 MiB) this is fine; we'd switch
    // to streaming-into-MinIO when files get larger.
    const buffer = await part.toBuffer();
    if (buffer.length === 0) {
      return reply.code(400).send({ error: "empty_file" });
    }
    if (buffer.length > MAX_BYTES) {
      return reply.code(413).send({ error: "payload_too_large" });
    }

    const fields = part.fields as Record<string, { value?: unknown } | undefined>;
    const projectId =
      typeof fields?.projectId?.value === "string" && fields.projectId.value
        ? fields.projectId.value
        : null;
    const explicitName =
      typeof fields?.name?.value === "string" && fields.name.value
        ? fields.name.value
        : part.filename;
    const type =
      typeof fields?.type?.value === "string" && fields.type.value
        ? fields.type.value
        : "image";
    const folderId =
      typeof fields?.folderId?.value === "string" && fields.folderId.value
        ? fields.folderId.value
        : null;

    if (projectId) {
      const project = await fastify.prisma.project.findFirst({
        where: { id: projectId, tenantId },
        select: { id: true },
      });
      if (!project) {
        return reply.code(404).send({ error: "project_not_found" });
      }
    }
    if (folderId) {
      // Validate the folder belongs to this tenant before pinning the
      // upload to it. Cheaper to fail fast here than to write the
      // blob and then trip on the FK.
      const folder = await fastify.prisma.assetFolder.findFirst({
        where: { id: folderId, tenantId },
        select: { id: true },
      });
      if (!folder) return reply.code(404).send({ error: "folder_not_found" });
    }

    // Create the row first so we know the assetId before writing to MinIO —
    // makes the storage key deterministic and the row authoritative.
    const ext = extensionFor(part.mimetype, part.filename);
    const created = await fastify.prisma.asset.create({
      data: {
        tenantId,
        projectId,
        folderId,
        name: explicitName,
        slug: slugify(explicitName),
        type,
        mimeType: part.mimetype,
        fileSize: buffer.length,
        storageKey: "pending",
      },
    });
    const storageKey = fastify.storage.objectKey({
      tenantId,
      projectId,
      assetId: created.id,
      extension: ext,
    });

    try {
      await fastify.storage.putObject(storageKey, buffer, {
        contentType: part.mimetype,
      });
    } catch (err) {
      // Roll back the DB row if storage fails — otherwise we'd have an
      // Asset row pointing at nothing.
      await fastify.prisma.asset.delete({ where: { id: created.id } }).catch(() => undefined);
      request.log.error({ err }, "asset upload to storage failed");
      return reply.code(502).send({ error: "storage_unavailable" });
    }

    const asset = await fastify.prisma.asset.update({
      where: { id: created.id },
      data: { storageKey },
    });
    return reply.code(201).send({ asset });
  });

  fastify.delete("/api/v1/assets/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const asset = await fastify.prisma.asset.findFirst({
      where: { id, tenantId },
    });
    if (!asset) {
      return reply.code(404).send({ error: "not_found" });
    }

    // Best-effort: delete from storage first so a stuck DB row doesn't leave
    // an orphaned object. If storage delete fails we still try the row, and
    // log the orphan for cleanup.
    try {
      await fastify.storage.removeObject(asset.storageKey);
    } catch (err) {
      request.log.warn({ err, key: asset.storageKey }, "storage delete failed; continuing");
    }
    await fastify.prisma.asset.delete({ where: { id: asset.id } }).catch(() => undefined);
    return reply.code(204).send();
  });

  // Eagerly bind Prisma so unused-import lint stays quiet — keeps the type
  // import live for future schema-bound updates.
  void Prisma;
}
