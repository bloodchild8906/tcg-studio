/**
 * Collaboration routes — profile, notifications, tasks, messages,
 * milestones (sec spec extension).
 *
 * Bundled into one file because they share a lot of conventions:
 * tenant-scoped, simple CRUD, minimal validation. Splitting per
 * feature is fine but a 1000-line single file is easier to navigate
 * during the v0 scaffold.
 *
 * Endpoints (all tenant-scoped, JWT-auth or API-key auth):
 *
 *   Profile (user-level — works without tenant)
 *     GET   /api/v1/me/profile             current user with profile fields
 *     PATCH /api/v1/me/profile             update display name, bio, tz, prefs, avatar
 *
 *   Notifications (per-user)
 *     GET   /api/v1/notifications          list, optional ?unreadOnly
 *     POST  /api/v1/notifications/:id/read mark single read
 *     POST  /api/v1/notifications/read-all mark all read
 *     DELETE /api/v1/notifications/:id     remove
 *
 *   Tasks (tenant + optional project)
 *     GET    /api/v1/tasks                 list, filterable by project / assignee / status
 *     POST   /api/v1/tasks                 create
 *     PATCH  /api/v1/tasks/:id             update fields
 *     DELETE /api/v1/tasks/:id             delete
 *
 *   Messaging
 *     GET   /api/v1/channels                list channels
 *     POST  /api/v1/channels                create
 *     GET   /api/v1/channels/:id/messages   list messages (cursor by `before`)
 *     POST  /api/v1/channels/:id/messages   post message
 *     DELETE /api/v1/messages/:id           soft-delete
 *
 *   Milestones (project-scoped)
 *     GET    /api/v1/milestones             list, filter by project
 *     POST   /api/v1/milestones             create
 *     PATCH  /api/v1/milestones/:id         update
 *     DELETE /api/v1/milestones/:id         delete
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { channels, emit } from "@/plugins/realtime";

const idParam = z.object({ id: z.string().min(1) });

// ===========================================================================
// Profile
// ===========================================================================

const profilePatch = z.object({
  displayName: z.string().max(80).nullable().optional(),
  bio: z.string().max(4000).optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  preferencesJson: z.record(z.unknown()).optional(),
});

// ===========================================================================
// Notifications
// ===========================================================================

const notificationListQuery = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().optional(),
});

// ===========================================================================
// Tasks
// ===========================================================================

const taskCreateBody = z.object({
  projectId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  status: z.enum(["todo", "in_progress", "review", "done", "archived"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  labels: z.array(z.string().max(40)).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
const taskPatchBody = taskCreateBody.partial().extend({
  sortOrder: z.number().int().optional(),
});

// ===========================================================================
// Channels / Messages
// ===========================================================================

const channelCreateBody = z.object({
  slug: z.string().min(1).max(40).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  projectId: z.string().min(1).nullable().optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

const messageCreateBody = z.object({
  body: z.string().min(1).max(4000),
});

// ===========================================================================
// Milestones
// ===========================================================================

const milestoneCreateBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(8000).optional(),
  status: z.enum(["upcoming", "active", "done", "cancelled"]).optional(),
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
const milestonePatchBody = milestoneCreateBody.omit({ projectId: true }).partial();

// ===========================================================================

export default async function collabRoutes(fastify: FastifyInstance) {
  // ---------- Profile -----------------------------------------------------

  fastify.get("/api/v1/me/profile", async (request) => {
    const user = requireUser(request);
    const full = await fastify.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        displayName: true,
        bio: true,
        avatarAssetId: true,
        timezone: true,
        preferencesJson: true,
        createdAt: true,
      },
    });
    return { profile: full };
  });

  fastify.patch("/api/v1/me/profile", async (request) => {
    const user = requireUser(request);
    const body = profilePatch.parse(request.body);
    const data: Prisma.UserUpdateInput = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.avatarAssetId !== undefined) data.avatarAssetId = body.avatarAssetId;
    if (body.timezone !== undefined) data.timezone = body.timezone;
    if (body.preferencesJson !== undefined) {
      data.preferencesJson = body.preferencesJson as unknown as Prisma.InputJsonValue;
    }
    const updated = await fastify.prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        displayName: true,
        bio: true,
        avatarAssetId: true,
        timezone: true,
        preferencesJson: true,
      },
    });
    return { profile: updated };
  });

  // ---------- Notifications ----------------------------------------------

  fastify.get("/api/v1/notifications", async (request) => {
    const user = requireUser(request);
    const q = notificationListQuery.parse(request.query ?? {});
    const limit = q.limit ?? 50;
    const rows = await fastify.prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(q.unreadOnly ? { readAt: null } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const unreadCount = await fastify.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return {
      notifications: rows,
      unreadCount,
      nextBefore:
        rows.length === limit ? rows[rows.length - 1].createdAt : null,
    };
  });

  fastify.post("/api/v1/notifications/:id/read", async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0)
      return reply.code(404).send({ error: "not_found_or_already_read" });
    return reply.code(204).send();
  });

  fastify.post("/api/v1/notifications/read-all", async (request) => {
    const user = requireUser(request);
    await fastify.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  fastify.delete("/api/v1/notifications/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.notification.deleteMany({
      where: { id, userId: user.id },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // ---------- Tasks -------------------------------------------------------

  fastify.get("/api/v1/tasks", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = request.query as Record<string, string | undefined>;
    const tasks = await fastify.prisma.tenantTask.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 1000,
    });
    return { tasks };
  });

  fastify.post("/api/v1/tasks", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const body = taskCreateBody.parse(request.body);
    const task = await fastify.prisma.tenantTask.create({
      data: {
        tenantId,
        projectId: body.projectId ?? null,
        title: body.title,
        description: body.description ?? "",
        assigneeId: body.assigneeId ?? null,
        status: body.status ?? "todo",
        priority: body.priority ?? "normal",
        labels: (body.labels ?? []) as unknown as Prisma.InputJsonValue,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        createdBy: user.id,
      },
    });
    // Auto-notify the assignee.
    if (task.assigneeId && task.assigneeId !== user.id) {
      const notif = await fastify.prisma.notification.create({
        data: {
          userId: task.assigneeId,
          tenantId,
          kind: "task.assigned",
          title: `Task assigned: ${task.title}`,
          link: `/admin/tasks/${task.id}`,
        },
      });
      emit({
        channel: channels.user(tenantId, task.assigneeId),
        kind: "notification.created",
        payload: { notification: notif },
      });
    }
    return reply.code(201).send({ task });
  });

  fastify.patch("/api/v1/tasks/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = taskPatchBody.parse(request.body);

    const data: Prisma.TenantTaskUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.assigneeId !== undefined) {
      data.assignee = body.assigneeId
        ? { connect: { id: body.assigneeId } }
        : { disconnect: true };
    }
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === "done") data.closedAt = new Date();
    }
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.labels !== undefined) {
      data.labels = body.labels as unknown as Prisma.InputJsonValue;
    }
    if (body.dueAt !== undefined) {
      data.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    }
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const result = await fastify.prisma.tenantTask.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const task = await fastify.prisma.tenantTask.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { task };
  });

  fastify.delete("/api/v1/tasks/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.tenantTask.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // ---------- Channels / Messages ----------------------------------------

  fastify.get("/api/v1/channels", async (request) => {
    const { tenantId } = requireTenant(request);
    const channels = await fastify.prisma.channel.findMany({
      where: { tenantId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    // Auto-create #general on first read so a fresh tenant has a usable
    // default channel without a separate setup step.
    if (channels.length === 0) {
      const created = await fastify.prisma.channel.create({
        data: {
          tenantId,
          slug: "general",
          name: "general",
          description: "Tenant-wide chat.",
        },
      });
      return { channels: [created] };
    }
    return { channels };
  });

  fastify.post("/api/v1/channels", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = channelCreateBody.parse(request.body);
    const channel = await fastify.prisma.channel.create({
      data: {
        tenantId,
        slug: body.slug,
        name: body.name,
        description: body.description ?? "",
        projectId: body.projectId ?? null,
        visibility: body.visibility ?? "public",
      },
    });
    return reply.code(201).send({ channel });
  });

  fastify.get("/api/v1/channels/:id/messages", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const q = request.query as Record<string, string | undefined>;

    const channel = await fastify.prisma.channel.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!channel) return reply.code(404).send({ error: "channel_not_found" });

    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const before = q.before ? new Date(q.before) : undefined;

    const messages = await fastify.prisma.message.findMany({
      where: {
        channelId: channel.id,
        deletedAt: null,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarAssetId: true } },
      },
    });
    return {
      messages: messages.reverse(),
      nextBefore:
        messages.length === limit ? messages[0].createdAt : null,
    };
  });

  fastify.post("/api/v1/channels/:id/messages", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = messageCreateBody.parse(request.body);

    const channel = await fastify.prisma.channel.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!channel) return reply.code(404).send({ error: "channel_not_found" });

    const message = await fastify.prisma.message.create({
      data: {
        tenantId,
        channelId: channel.id,
        authorId: user.id,
        body: body.body,
        bodyHtml: escapeHtml(body.body),
      },
      include: {
        author: { select: { id: true, name: true, displayName: true, avatarAssetId: true } },
      },
    });
    return reply.code(201).send({ message });
  });

  fastify.delete("/api/v1/messages/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    // Soft delete + only the author can delete their own message.
    const result = await fastify.prisma.message.updateMany({
      where: { id, tenantId, authorId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // ---------- Milestones --------------------------------------------------

  fastify.get("/api/v1/milestones", async (request) => {
    const { tenantId } = requireTenant(request);
    const q = request.query as Record<string, string | undefined>;
    const milestones = await fastify.prisma.milestone.findMany({
      where: {
        tenantId,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { dueAt: "asc" }],
    });
    return { milestones };
  });

  fastify.post("/api/v1/milestones", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = milestoneCreateBody.parse(request.body);
    const milestone = await fastify.prisma.milestone.create({
      data: {
        tenantId,
        projectId: body.projectId,
        name: body.name,
        description: body.description ?? "",
        status: body.status ?? "upcoming",
        startAt: body.startAt ? new Date(body.startAt) : null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.code(201).send({ milestone });
  });

  fastify.patch("/api/v1/milestones/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = milestonePatchBody.parse(request.body);
    const data: Prisma.MilestoneUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === "done" || body.status === "cancelled")
        data.closedAt = new Date();
    }
    if (body.startAt !== undefined) {
      data.startAt = body.startAt ? new Date(body.startAt) : null;
    }
    if (body.dueAt !== undefined) {
      data.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    }
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    const result = await fastify.prisma.milestone.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const milestone = await fastify.prisma.milestone.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { milestone };
  });

  fastify.delete("/api/v1/milestones/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.milestone.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}

/**
 * Minimal HTML escaping for chat messages. We render plaintext in the
 * client and only allow newlines + URL auto-link via a CSS rule.
 * Future: swap this for a markdown parser + sanitizer when richer
 * formatting becomes a real need.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
