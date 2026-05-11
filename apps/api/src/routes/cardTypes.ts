/**
 * Card type routes (sec 17).
 *
 * Card types live under a project. The `schemaJson` blob defines the field
 * shape of cards-of-this-type (sec 22) — for v0 we trust the client; later we
 * compile it into a runtime validator.
 */

import type { FastifyInstance } from "fastify";
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
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  schemaJson: z.unknown().optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  description: z.string().max(2000).optional(),
  schemaJson: z.unknown().optional(),
  status: z
    .enum(["draft", "review", "approved", "released", "deprecated", "archived"])
    .optional(),
  activeTemplateId: z.string().nullable().optional(),
});

export default async function cardTypeRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/card-types", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const cardTypes = await fastify.prisma.cardType.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: { updatedAt: "desc" },
    });
    return { cardTypes };
  });

  fastify.post("/api/v1/card-types", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    // Confirm the project belongs to this tenant before linking — prevents
    // cross-tenant attachment via a guessed project id.
    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const cardType = await fastify.prisma.cardType.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        schemaJson: (body.schemaJson as object) ?? { fields: [] },
      },
    });
    return reply.code(201).send({ cardType });
  });

  fastify.get("/api/v1/card-types/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const cardType = await fastify.prisma.cardType.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { cardType };
  });

  fastify.patch("/api/v1/card-types/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);
    const result = await fastify.prisma.cardType.updateMany({
      where: { id, tenantId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.slug !== undefined && { slug: body.slug }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.schemaJson !== undefined && { schemaJson: body.schemaJson as object }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.activeTemplateId !== undefined && {
          activeTemplateId: body.activeTemplateId,
        }),
      },
    });
    if (result.count === 0) return { error: "not_found" };
    const cardType = await fastify.prisma.cardType.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { cardType };
  });

  fastify.delete("/api/v1/card-types/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.cardType.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
