/**
 * Ruleset routes (sec 23).
 *
 * Project-scoped game-rules definitions consumed by the playtest engine.
 * Same shape as the other project-scoped resources.
 *
 * Why we don't validate `configJson` server-side beyond a shallow check:
 * the playtest engine on the client is the canonical interpreter, and
 * authors iterate on rules fast. A strict schema here would force a
 * migration every time someone wants a new auto-action kind. The client
 * round-trips its TypeScript shape in JSON form.
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

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  sortOrder: z.number().int().optional(),
  isDefault: z.boolean().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function rulesetRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/rulesets", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const rulesets = await fastify.prisma.ruleset.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return { rulesets };
  });

  fastify.post("/api/v1/rulesets", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);
    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const ruleset = await fastify.prisma.ruleset.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        configJson: (body.configJson ?? {}) as unknown as Prisma.InputJsonValue,
        status: body.status ?? "draft",
        sortOrder: body.sortOrder ?? 0,
        isDefault: body.isDefault ?? false,
      },
    });

    // If this ruleset is being set as the default, clear the flag on
    // any sibling — only one default per project so the playtest
    // launcher has an unambiguous "use this" choice.
    if (ruleset.isDefault) {
      await fastify.prisma.ruleset.updateMany({
        where: {
          tenantId,
          projectId: project.id,
          id: { not: ruleset.id },
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    return reply.code(201).send({ ruleset });
  });

  fastify.get("/api/v1/rulesets/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const ruleset = await fastify.prisma.ruleset.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { ruleset };
  });

  fastify.patch("/api/v1/rulesets/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.RulesetUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.configJson !== undefined) {
      data.configJson = body.configJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.isDefault !== undefined) data.isDefault = body.isDefault;

    const result = await fastify.prisma.ruleset.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };

    const ruleset = await fastify.prisma.ruleset.findFirstOrThrow({
      where: { id, tenantId },
    });

    // Maintain "single default" invariant whenever isDefault flips on.
    if (body.isDefault === true) {
      await fastify.prisma.ruleset.updateMany({
        where: {
          tenantId,
          projectId: ruleset.projectId,
          id: { not: ruleset.id },
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    return { ruleset };
  });

  fastify.delete("/api/v1/rulesets/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.ruleset.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
