/**
 * Keyword routes (sec 25).
 *
 * One project's keyword glossary. Endpoints follow the same shape as sets /
 * card types — list filtered by projectId, full CRUD, tenant + project
 * ownership cross-checked on every write.
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const idParam = z.object({ id: z.string().min(1) });

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(80),
  slug: slugSchema,
  reminderText: z.string().max(400).optional(),
  rulesDefinition: z.string().max(4000).optional(),
  category: z.string().max(40).optional(),
  parametersJson: z.array(z.record(z.string(), z.unknown())).optional(),
  iconAssetId: z.string().min(1).nullable().optional(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .nullable()
    .optional(),
  status: z.enum(["draft", "approved", "deprecated"]).optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function keywordRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/keywords", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const keywords = await fastify.prisma.keyword.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return { keywords };
  });

  fastify.post("/api/v1/keywords", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const keyword = await fastify.prisma.keyword.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        reminderText: body.reminderText ?? "",
        rulesDefinition: body.rulesDefinition ?? "",
        category: body.category ?? "general",
        parametersJson: (body.parametersJson ?? []) as unknown as Prisma.InputJsonValue,
        iconAssetId: body.iconAssetId ?? null,
        color: body.color ?? null,
        status: body.status ?? "draft",
      },
    });
    return reply.code(201).send({ keyword });
  });

  fastify.get("/api/v1/keywords/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const keyword = await fastify.prisma.keyword.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { keyword };
  });

  fastify.patch("/api/v1/keywords/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.KeywordUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.reminderText !== undefined) data.reminderText = body.reminderText;
    if (body.rulesDefinition !== undefined) data.rulesDefinition = body.rulesDefinition;
    if (body.category !== undefined) data.category = body.category;
    if (body.parametersJson !== undefined) {
      data.parametersJson = body.parametersJson as unknown as Prisma.InputJsonValue;
    }
    if (body.iconAssetId !== undefined) data.iconAssetId = body.iconAssetId;
    if (body.color !== undefined) data.color = body.color;
    if (body.status !== undefined) data.status = body.status;

    const result = await fastify.prisma.keyword.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const keyword = await fastify.prisma.keyword.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { keyword };
  });

  fastify.delete("/api/v1/keywords/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.keyword.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
