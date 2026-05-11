/**
 * Variant badge routes.
 *
 * Project-scoped catalog of visual stamps (foil / promo / showcase /
 * alt-art) applied to cards. The frontend renders matching badges via
 * a dedicated `variant_badge` layer type on the card template.
 *
 * Cards opt into a badge in two ways:
 *   1. Manual — `dataJson.variantBadges` array of badge ids
 *   2. Auto   — the badge's `conditionJson` evaluates against
 *               dataJson; matches automatically apply
 *
 * The API stores both — the renderer is the canonical evaluator.
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

const colorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  label: z.string().max(40).optional(),
  iconAssetId: z.string().min(1).nullable().optional(),
  color: colorSchema.optional(),
  textColor: colorSchema.optional(),
  shape: z.enum(["circle", "rounded", "banner", "star", "shield"]).optional(),
  position: z
    .enum(["top_left", "top_right", "bottom_left", "bottom_right", "bottom_center"])
    .optional(),
  conditionJson: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  sortOrder: z.number().int().optional(),
});

const patchBody = createBody.omit({ projectId: true }).partial();

export default async function variantBadgeRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/variant-badges", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const badges = await fastify.prisma.variantBadge.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { badges };
  });

  fastify.post("/api/v1/variant-badges", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);
    const project = await fastify.prisma.project.findFirst({
      where: { id: body.projectId, tenantId },
      select: { id: true },
    });
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const badge = await fastify.prisma.variantBadge.create({
      data: {
        tenantId,
        projectId: project.id,
        name: body.name,
        slug: body.slug,
        label: body.label ?? "",
        iconAssetId: body.iconAssetId ?? null,
        color: body.color ?? "#d4a24c",
        textColor: body.textColor ?? "#ffffff",
        shape: body.shape ?? "rounded",
        position: body.position ?? "top_right",
        conditionJson: (body.conditionJson ?? {}) as unknown as Prisma.InputJsonValue,
        status: body.status ?? "active",
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ badge });
  });

  fastify.get("/api/v1/variant-badges/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const badge = await fastify.prisma.variantBadge.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { badge };
  });

  fastify.patch("/api/v1/variant-badges/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Prisma.VariantBadgeUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.label !== undefined) data.label = body.label;
    if (body.iconAssetId !== undefined) data.iconAssetId = body.iconAssetId;
    if (body.color !== undefined) data.color = body.color;
    if (body.textColor !== undefined) data.textColor = body.textColor;
    if (body.shape !== undefined) data.shape = body.shape;
    if (body.position !== undefined) data.position = body.position;
    if (body.conditionJson !== undefined) {
      data.conditionJson = body.conditionJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.variantBadge.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const badge = await fastify.prisma.variantBadge.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { badge };
  });

  fastify.delete("/api/v1/variant-badges/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.variantBadge.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
