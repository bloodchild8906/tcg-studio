/**
 * Template routes.
 *
 * Templates store the JSON the Card Type Designer produces — exactly the
 * `CardTypeTemplate` shape (apps/designer/src/types.ts), opaque to the API.
 *
 * Endpoints:
 *   GET    /api/v1/templates?cardTypeId=...    list templates for a card type
 *   POST   /api/v1/templates                    create
 *   GET    /api/v1/templates/:id
 *   PATCH  /api/v1/templates/:id                update content + bump version
 *   DELETE /api/v1/templates/:id
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";

const idParam = z.object({ id: z.string().min(1) });

const createBody = z.object({
  projectId: z.string().min(1),
  cardTypeId: z.string().min(1),
  name: z.string().min(1).max(120),
  contentJson: z.record(z.string(), z.unknown()),
});

const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  status: z
    .enum(["draft", "review", "approved", "released", "deprecated", "archived"])
    .optional(),
});

export default async function templateRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/templates", async (request) => {
    const { tenantId } = requireTenant(request);
    const { cardTypeId, projectId } = (request.query as Record<string, string>) ?? {};
    const templates = await fastify.prisma.template.findMany({
      where: {
        tenantId,
        ...(cardTypeId ? { cardTypeId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
    return { templates };
  });

  fastify.post("/api/v1/templates", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);

    // Verify both project and card type belong to this tenant in one query
    // before we create — saves us from creating an orphan and rolling back.
    const cardType = await fastify.prisma.cardType.findFirst({
      where: { id: body.cardTypeId, tenantId, projectId: body.projectId },
      select: { id: true, projectId: true },
    });
    if (!cardType) {
      return reply.code(404).send({ error: "card_type_not_found" });
    }

    const template = await fastify.prisma.template.create({
      data: {
        tenantId,
        projectId: cardType.projectId,
        cardTypeId: cardType.id,
        name: body.name,
        contentJson: body.contentJson as unknown as Prisma.InputJsonValue,
      },
    });
    return reply.code(201).send({ template });
  });

  fastify.get("/api/v1/templates/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const template = await fastify.prisma.template.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { template };
  });

  fastify.patch("/api/v1/templates/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    // Bump version whenever content changes — gives clients an optimistic-
    // concurrency hook later (compare versions on save).
    const data: Prisma.TemplateUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.status !== undefined) data.status = body.status;
    if (body.contentJson !== undefined) {
      data.contentJson = body.contentJson as unknown as Prisma.InputJsonValue;
      data.version = { increment: 1 };
    }

    const result = await fastify.prisma.template.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const template = await fastify.prisma.template.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { template };
  });

  fastify.delete("/api/v1/templates/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.template.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
