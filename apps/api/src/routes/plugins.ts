/**
 * Plugin manager shell (sec 34).
 *
 * v0 routes — read-only catalog + per-tenant install/uninstall/toggle.
 * Plugin authoring + sandboxed execution come later; for now this
 * gives tenants a place to see what's available and queue what they'd
 * want enabled. Existing extension points (CMS block registry, asset
 * pipelines, exporters) keep their hardcoded lists; once the runtime
 * loader exists, those registries will read from PluginInstall too.
 *
 * Endpoints:
 *   GET  /api/v1/plugins                 list catalog (everyone)
 *   GET  /api/v1/plugins/installs        list installs for active tenant
 *   POST /api/v1/plugins/:id/install     install (idempotent)
 *   POST /api/v1/plugins/:id/uninstall   delete the install row
 *   PATCH /api/v1/plugins/installs/:id   toggle enabled / settingsJson
 *
 * Audit: install / uninstall / toggle each write a row.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";

const idParam = z.object({ id: z.string().min(1) });

const patchInstallBody = z.object({
  enabled: z.boolean().optional(),
  settingsJson: z.record(z.unknown()).optional(),
});

export default async function pluginRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/plugins", async () => {
    const plugins = await fastify.prisma.plugin.findMany({
      where: { status: { in: ["approved", "review"] } },
      orderBy: [{ name: "asc" }],
    });
    return { plugins };
  });

  fastify.get("/api/v1/plugins/installs", async (request) => {
    const { tenantId } = requireTenant(request);
    const installs = await fastify.prisma.pluginInstall.findMany({
      where: { tenantId },
      include: { plugin: true },
      orderBy: { createdAt: "desc" },
    });
    return { installs };
  });

  fastify.post("/api/v1/plugins/:id/install", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const plugin = await fastify.prisma.plugin.findUnique({ where: { id } });
    if (!plugin || plugin.status === "deprecated") {
      return reply.code(404).send({ error: "plugin_not_found" });
    }

    // Idempotent — re-install on top of an existing row just flips
    // enabled back to true and resets settings. We expose
    // `settingsJson` updates through the patch route.
    const install = await fastify.prisma.pluginInstall.upsert({
      where: { tenantId_pluginId: { tenantId, pluginId: id } },
      create: {
        tenantId,
        pluginId: id,
        enabled: true,
      },
      update: { enabled: true },
      include: { plugin: true },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "plugin.install",
      actorUserId: user.id,
      entityType: "plugin",
      entityId: id,
      metadata: { slug: plugin.slug },
    });

    return reply.code(201).send({ install });
  });

  fastify.post("/api/v1/plugins/:id/uninstall", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const result = await fastify.prisma.pluginInstall.deleteMany({
      where: { tenantId, pluginId: id },
    });
    if (result.count === 0)
      return reply.code(404).send({ error: "not_installed" });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: "plugin.uninstall",
      actorUserId: user.id,
      entityType: "plugin",
      entityId: id,
    });

    return reply.code(204).send();
  });

  fastify.patch("/api/v1/plugins/installs/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = patchInstallBody.parse(request.body);

    const data: Prisma.PluginInstallUpdateInput = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.settingsJson !== undefined) {
      data.settingsJson = body.settingsJson as unknown as Prisma.InputJsonValue;
    }

    const result = await fastify.prisma.pluginInstall.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0)
      return reply.code(404).send({ error: "not_found" });

    const install = await fastify.prisma.pluginInstall.findFirstOrThrow({
      where: { id, tenantId },
      include: { plugin: true },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: body.enabled === false ? "plugin.disable" : "plugin.update",
      actorUserId: user.id,
      entityType: "plugin",
      entityId: install.pluginId,
    });

    return { install };
  });
}
