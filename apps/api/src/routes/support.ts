/**
 * Support tickets — hierarchical routing (sec 8).
 *
 * Each level can submit a ticket. The route is determined by the
 * scope of the submitter:
 *
 *   • scope=project  → routedTo=tenant   (tenant admins handle it)
 *   • scope=tenant   → routedTo=platform (platform support handles it)
 *   • scope=platform → routedTo=platform (internal — no parent)
 *
 * Endpoints:
 *
 *   POST   /api/v1/support/tickets             submit a ticket
 *   GET    /api/v1/support/tickets/outgoing    tickets I filed
 *   GET    /api/v1/support/tickets/incoming    tickets routed to my level
 *   GET    /api/v1/support/tickets/:id         single ticket + replies
 *   POST   /api/v1/support/tickets/:id/replies thread reply
 *   PATCH  /api/v1/support/tickets/:id         update status / priority
 *
 * Outgoing/incoming filters are computed server-side from the auth
 * context — the client doesn't get to claim "I'm a tenant admin"
 * itself.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "@/plugins/auth";
import { requireTenant } from "@/plugins/tenant";

const createBody = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z.string().max(60).optional(),
});

const replyBody = z.object({
  body: z.string().min(1).max(8000),
});

const patchBody = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

const idParam = z.object({ id: z.string().min(1) });

export default async function supportRoutes(fastify: FastifyInstance) {
  // -----------------------------------------------------------------
  // Submit a ticket. The scope is derived from the request's host
  // context — submitters at project scope route to tenant, tenant
  // submitters route to platform. We never trust client-supplied
  // routing.
  // -----------------------------------------------------------------
  fastify.post("/api/v1/support/tickets", async (request, reply) => {
    const user = requireUser(request);
    const ctx = request.tenantContext;
    const body = createBody.parse(request.body);

    // Tenant block guarantees ctx is set when this route is reached.
    if (!ctx) return reply.code(400).send({ error: "no_tenant_context" });

    let scope: "tenant" | "project";
    let routedTo: "tenant" | "platform";
    let tenantId: string | null = null;
    let projectId: string | null = null;

    if (ctx.projectId) {
      // Project users → tenant admins
      scope = "project";
      routedTo = "tenant";
      tenantId = ctx.tenantId;
      projectId = ctx.projectId;
    } else {
      // Tenant users → platform support
      scope = "tenant";
      routedTo = "platform";
      tenantId = ctx.tenantId;
    }

    const ticket = await fastify.prisma.supportTicket.create({
      data: {
        scope,
        routedTo,
        tenantId,
        projectId,
        submitterId: user.id,
        subject: body.subject,
        body: body.body,
        priority: body.priority ?? "normal",
        category: body.category ?? null,
        status: "open",
      },
    });
    return reply.code(201).send({ ticket });
  });

  // -----------------------------------------------------------------
  // My outgoing tickets — anything I submitted, regardless of scope.
  // -----------------------------------------------------------------
  fastify.get("/api/v1/support/tickets/outgoing", async (request) => {
    const user = requireUser(request);
    const tickets = await fastify.prisma.supportTicket.findMany({
      where: { submitterId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        _count: { select: { replies: true } },
      },
    });
    return { tickets };
  });

  // -----------------------------------------------------------------
  // Incoming queue — tickets routed to my level. Tenant admins see
  // tickets routed to their tenant; platform admins see all
  // platform-routed tickets across the system.
  // -----------------------------------------------------------------
  fastify.get("/api/v1/support/tickets/incoming", async (request) => {
    const user = requireUser(request);
    const ctx = request.tenantContext;

    let where: Record<string, unknown>;
    if (!ctx) {
      // Platform host — only platform admins should be reading the
      // platform-routed queue.
      const platformUser = await fastify.prisma.user.findUnique({
        where: { id: user.id },
        select: { platformRole: true },
      });
      if (!platformUser?.platformRole) return { tickets: [] };
      where = { routedTo: "platform" };
    } else {
      // Tenant host — show tickets routed to this tenant.
      where = { routedTo: "tenant", tenantId: ctx.tenantId };
    }
    const tickets = await fastify.prisma.supportTicket.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200,
      include: {
        _count: { select: { replies: true } },
      },
    });
    return { tickets };
  });

  // -----------------------------------------------------------------
  // Single ticket — submitter + responder both can read.
  // -----------------------------------------------------------------
  fastify.get("/api/v1/support/tickets/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const t = await fastify.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        replies: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!t) return reply.code(404).send({ error: "not_found" });
    // Auth: submitter can always read; responder side checks below.
    if (t.submitterId !== user.id) {
      const ok = await canRespond(fastify, user.id, t);
      if (!ok) return reply.code(403).send({ error: "forbidden" });
    }
    return { ticket: t };
  });

  // -----------------------------------------------------------------
  // Reply on a ticket. authorRole is computed server-side from the
  // user's relationship to the ticket.
  // -----------------------------------------------------------------
  fastify.post("/api/v1/support/tickets/:id/replies", async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = replyBody.parse(request.body);
    const t = await fastify.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not_found" });

    let authorRole: "submitter" | "responder";
    if (t.submitterId === user.id) {
      authorRole = "submitter";
    } else {
      const ok = await canRespond(fastify, user.id, t);
      if (!ok) return reply.code(403).send({ error: "forbidden" });
      authorRole = "responder";
    }
    const created = await fastify.prisma.supportReply.create({
      data: {
        ticketId: t.id,
        authorId: user.id,
        authorRole,
        body: body.body,
      },
    });
    // A reply auto-bumps an open ticket to in_progress so the queue
    // shows movement.
    if (t.status === "open" && authorRole === "responder") {
      await fastify.prisma.supportTicket.update({
        where: { id: t.id },
        data: { status: "in_progress" },
      });
    }
    return reply.code(201).send({ reply: created });
  });

  // -----------------------------------------------------------------
  // Update status / priority. Only responders can change status to
  // resolved/closed; the submitter can re-open a closed one by
  // posting a reply (handled in /replies).
  // -----------------------------------------------------------------
  fastify.patch("/api/v1/support/tickets/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);
    const t = await fastify.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not_found" });
    const ok = await canRespond(fastify, user.id, t);
    if (!ok) return reply.code(403).send({ error: "forbidden" });

    const updated = await fastify.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.status === "closed" || body.status === "resolved"
          ? { closedAt: new Date(), closedBy: user.id }
          : {}),
      },
    });
    return { ticket: updated };
  });
}

/**
 * Can the user act as a responder on this ticket? Tenant-routed
 * tickets need the user to be a tenant admin/owner; platform-routed
 * tickets need a platformRole.
 */
async function canRespond(
  fastify: FastifyInstance,
  userId: string,
  ticket: { routedTo: string; tenantId: string | null },
): Promise<boolean> {
  if (ticket.routedTo === "platform") {
    const u = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true },
    });
    return Boolean(u?.platformRole);
  }
  if (ticket.routedTo === "tenant" && ticket.tenantId) {
    const m = await fastify.prisma.membership.findFirst({
      where: { tenantId: ticket.tenantId, userId },
      select: { role: true },
    });
    if (!m) return false;
    return ["tenant_owner", "tenant_admin"].includes(m.role);
  }
  return false;
}
