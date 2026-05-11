/**
 * Board layout routes (sec 26).
 *
 * Project-scoped board layouts — playmat / play area definitions
 * consumed by the manual playtest view. Same shape as the other
 * project-scoped resources.
 *
 * Why we don't validate `zonesJson` server-side beyond a basic shape
 * check: zone definitions evolve quickly per game (new flags for hidden
 * info, attached zones, command zones, etc.), and the playtest engine
 * is the canonical interpreter. The API just round-trips the blob.
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

const zoneSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().max(80),
    /** deck | hand | discard | exile | battlefield | resource | command | sideboard | shared | token | custom */
    kind: z.string().max(40),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    /** "p1" | "p2" | "shared". Drives which player can interact. */
    owner: z.string().max(40).default("shared"),
    /** "public" | "private" | "owner_only". Affects card-back rendering. */
    visibility: z.string().max(40).default("public"),
    /** stacked | spread | row | grid | fan. Drives card-layout within the zone. */
    stackMode: z.string().max(40).default("stacked"),
    rotation: z.number().default(0),
    color: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .optional(),
    /** Maximum cards allowed in this zone. 0 = unlimited. */
    maxCards: z.number().int().min(0).optional(),
  })
  .passthrough();

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  width: z.number().int().min(64).max(8192).optional(),
  height: z.number().int().min(64).max(8192).optional(),
  background: z.string().max(40).optional(),
  zonesJson: z.array(zoneSchema).optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  sortOrder: z.number().int().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function boardRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/boards", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const boards = await fastify.prisma.boardLayout.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { boards };
  });

  fastify.post("/api/v1/boards", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);
    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const board = await fastify.prisma.boardLayout.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        width: body.width ?? 1920,
        height: body.height ?? 1080,
        background: body.background ?? "#1a1d2a",
        zonesJson: (body.zonesJson ?? []) as unknown as Prisma.InputJsonValue,
        metadataJson: (body.metadataJson ?? {}) as unknown as Prisma.InputJsonValue,
        status: body.status ?? "draft",
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ board });
  });

  fastify.get("/api/v1/boards/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const board = await fastify.prisma.boardLayout.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { board };
  });

  fastify.patch("/api/v1/boards/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.BoardLayoutUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.width !== undefined) data.width = body.width;
    if (body.height !== undefined) data.height = body.height;
    if (body.background !== undefined) data.background = body.background;
    if (body.zonesJson !== undefined) {
      data.zonesJson = body.zonesJson as unknown as Prisma.InputJsonValue;
    }
    if (body.metadataJson !== undefined) {
      data.metadataJson = body.metadataJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.boardLayout.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const board = await fastify.prisma.boardLayout.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { board };
  });

  fastify.delete("/api/v1/boards/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.boardLayout.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
