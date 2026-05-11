/**
 * Asset folder routes (sec 20).
 *
 * The asset library is a folder tree. Each AssetFolder belongs to a
 * tenant (and optionally a project), can have a parent, and contains
 * assets + child folders. The frontend file-explorer hits this for:
 *
 *   GET    /api/v1/asset-folders             list folders (tree)
 *   POST   /api/v1/asset-folders             create folder
 *   PATCH  /api/v1/asset-folders/:id         rename / move
 *   DELETE /api/v1/asset-folders/:id         delete (cascades children)
 *
 * Cycle prevention: when moving a folder under a new parent, we walk
 * the parent chain and refuse if the target is the folder itself or
 * one of its descendants.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  projectId: z.string().min(1).optional(),
  /// When set, return only this folder's direct children. Omit for
  /// the full tree (the frontend builds a recursive view from it).
  parentId: z.union([z.string().min(1), z.literal("null")]).optional(),
});

const createBody = z.object({
  name: z.string().min(1).max(160),
  /// URL-safe identifier — auto-derived from name when omitted.
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  parentId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  parentId: z.string().min(1).nullable().optional(),
});

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "folder"
  );
}

export default async function assetFolderRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/asset-folders", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = listQuery.parse(request.query ?? {});
    const folders = await fastify.prisma.assetFolder.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.parentId === "null"
          ? { parentId: null }
          : q.parentId
            ? { parentId: q.parentId }
            : {}),
      },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
      // Surface aggregate counts so the file-explorer can show
      // "Frames (12)" without a follow-up request per row.
      include: {
        _count: { select: { assets: true, children: true } },
      },
    });
    return { folders };
  });

  fastify.post("/api/v1/asset-folders", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);
    const slug = body.slug ?? slugify(body.name);

    // Validate parent belongs to this tenant before creating.
    if (body.parentId) {
      const parent = await fastify.prisma.assetFolder.findFirst({
        where: { id: body.parentId, tenantId },
        select: { id: true, projectId: true },
      });
      if (!parent) return reply.code(404).send({ error: "parent_not_found" });
      // Children inherit the parent's project scope by default — the
      // user can't make a tenant-scope folder a child of a project-
      // scope folder or vice versa. (We could relax this later if the
      // UX wants it.)
      if ((parent.projectId ?? null) !== (body.projectId ?? null)) {
        return reply.code(409).send({
          error: "scope_mismatch",
          message:
            "Folder scope must match its parent (tenant vs project).",
        });
      }
    }

    try {
      const folder = await fastify.prisma.assetFolder.create({
        data: {
          tenantId,
          projectId: body.projectId ?? null,
          parentId: body.parentId ?? null,
          name: body.name,
          slug,
        },
      });
      return reply.code(201).send({ folder });
    } catch (err) {
      // Unique-constraint violation = sibling with the same slug.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        return reply.code(409).send({
          error: "slug_taken",
          message: "A folder with that slug already exists at this location.",
        });
      }
      throw err;
    }
  });

  fastify.patch("/api/v1/asset-folders/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const existing = await fastify.prisma.assetFolder.findFirst({
      where: { id, tenantId },
      select: { id: true, parentId: true, projectId: true },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    // Prevent cycles when re-parenting: walk up from the candidate
    // parent and refuse if we hit `id` along the way.
    if (body.parentId !== undefined && body.parentId !== existing.parentId) {
      if (body.parentId === id) {
        return reply.code(409).send({ error: "cycle", message: "A folder can't be its own parent." });
      }
      if (body.parentId !== null) {
        const parent = await fastify.prisma.assetFolder.findFirst({
          where: { id: body.parentId, tenantId },
          select: { id: true, projectId: true },
        });
        if (!parent) return reply.code(404).send({ error: "parent_not_found" });
        if ((parent.projectId ?? null) !== (existing.projectId ?? null)) {
          return reply.code(409).send({ error: "scope_mismatch" });
        }

        // Walk ancestors to detect a cycle.
        let cursor: string | null = parent.id;
        const seen = new Set<string>();
        while (cursor) {
          if (seen.has(cursor)) break; // shouldn't happen, but bound the loop
          seen.add(cursor);
          if (cursor === id) {
            return reply.code(409).send({
              error: "cycle",
              message: "Can't move a folder into one of its descendants.",
            });
          }
          const next: { parentId: string | null } | null =
            await fastify.prisma.assetFolder.findUnique({
              where: { id: cursor },
              select: { parentId: true },
            });
          cursor = next?.parentId ?? null;
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.parentId !== undefined) data.parentId = body.parentId;

    try {
      const folder = await fastify.prisma.assetFolder.update({
        where: { id },
        data,
      });
      return reply.send({ folder });
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        return reply.code(409).send({ error: "slug_taken" });
      }
      throw err;
    }
  });

  fastify.delete("/api/v1/asset-folders/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    // Cascade is handled by the schema — children + assets' folderId
    // fall to null (assets) or are removed (subfolders, recursively).
    const result = await fastify.prisma.assetFolder.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
