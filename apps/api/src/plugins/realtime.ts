/**
 * Realtime / WebSocket hub (sec 37).
 *
 * One Fastify plugin that owns the `/ws` upgrade endpoint plus a
 * tenant-aware channel registry. Routes elsewhere in the app push
 * events through a tiny dispatch helper; the hub routes each event
 * to every connection subscribed to a matching channel.
 *
 * Channel naming follows the spec (sec 37.2):
 *
 *   tenant:{tenantId}                          — tenant-wide bus
 *   tenant:{tenantId}:project:{projectId}      — project events
 *   tenant:{tenantId}:cms:{siteId}             — CMS events
 *   tenant:{tenantId}:exports                  — export job state
 *   tenant:{tenantId}:validation               — validation runs
 *   tenant:{tenantId}:user:{userId}            — per-user notifications
 *
 * Auth — every connection authenticates with a JWT in the `?token=`
 * query param at upgrade time. We resolve the user, validate
 * tenant membership eagerly, and stamp `socket.tenantId` /
 * `socket.userId` so subscribe checks are O(1).
 *
 * Tenant isolation — clients send subscribe frames naming the
 * channel they want. The hub validates the channel string belongs
 * to the user's tenant before adding them to the subscriber set.
 * A misbehaving client can only ever see channels for tenants the
 * user is a member of (the auth check at upgrade is the gate).
 *
 * Why one hub instead of pub/sub via Redis: single-process MVP. A
 * real multi-instance deployment swaps the in-memory `subscribers`
 * map for a Redis pub/sub bridge — the route-level emit calls don't
 * change.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import websocketPlugin from "@fastify/websocket";

interface ConnectionState {
  tenantId: string;
  userId: string;
  /** Channels this connection has subscribed to. */
  channels: Set<string>;
  /** Last activity tick — drives the idle ping. */
  lastSeen: number;
}

interface RealtimeEvent {
  /** Channel string the event targets. Subscribers to this exact
   *  string receive it. */
  channel: string;
  /** Dot-namespaced kind: comment.created, export.completed,
   *  notification, page.published, etc. */
  kind: string;
  /** Free-form payload — typed at the call site, opaque to the hub. */
  payload?: Record<string, unknown>;
}

type ClientFrame =
  | { type: "subscribe"; channel: string }
  | { type: "unsubscribe"; channel: string }
  | { type: "ping" };

/** WebSocket abstraction — `@fastify/websocket` exposes the raw
 *  ws-library socket so we keep our shape minimal. */
interface WSLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: "message" | "close" | "pong", cb: (data?: unknown) => void) => void;
  ping?: () => void;
}

class RealtimeHub {
  /** All open connections — one Set per WS so iteration is fast. */
  private connections = new Map<WSLike, ConnectionState>();
  /** channel → Set<WSLike>. Lookups dominate sends, so the
   *  reverse-index is worth maintaining. */
  private subscribers = new Map<string, Set<WSLike>>();

  /** Idle ping interval handle. */
  private heartbeat: NodeJS.Timeout | null = null;

  attach(socket: WSLike, state: Omit<ConnectionState, "channels" | "lastSeen">) {
    this.connections.set(socket, {
      ...state,
      channels: new Set(),
      lastSeen: Date.now(),
    });
    if (!this.heartbeat) this.startHeartbeat();

    socket.on("message", (raw) => {
      const conn = this.connections.get(socket);
      if (!conn) return;
      conn.lastSeen = Date.now();
      let frame: ClientFrame | null = null;
      try {
        const text = typeof raw === "string" ? raw : raw?.toString?.();
        frame = JSON.parse(text ?? "") as ClientFrame;
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;

      if (frame.type === "subscribe" && typeof frame.channel === "string") {
        if (!this.canSubscribe(conn, frame.channel)) {
          this.send(socket, { kind: "error", channel: frame.channel, reason: "forbidden" });
          return;
        }
        conn.channels.add(frame.channel);
        let set = this.subscribers.get(frame.channel);
        if (!set) {
          set = new Set();
          this.subscribers.set(frame.channel, set);
        }
        set.add(socket);
        this.send(socket, { kind: "subscribed", channel: frame.channel });
      } else if (
        frame.type === "unsubscribe" &&
        typeof frame.channel === "string"
      ) {
        conn.channels.delete(frame.channel);
        const set = this.subscribers.get(frame.channel);
        if (set) {
          set.delete(socket);
          if (set.size === 0) this.subscribers.delete(frame.channel);
        }
      } else if (frame.type === "ping") {
        this.send(socket, { kind: "pong" });
      }
    });

    socket.on("close", () => this.detach(socket));
    socket.on("pong", () => {
      const conn = this.connections.get(socket);
      if (conn) conn.lastSeen = Date.now();
    });

    // Send a hello so the client knows the upgrade succeeded
    // before its first message would otherwise be silently dropped.
    this.send(socket, { kind: "hello", tenantId: state.tenantId });
  }

  detach(socket: WSLike) {
    const conn = this.connections.get(socket);
    if (!conn) return;
    for (const ch of conn.channels) {
      const set = this.subscribers.get(ch);
      if (set) {
        set.delete(socket);
        if (set.size === 0) this.subscribers.delete(ch);
      }
    }
    this.connections.delete(socket);
    if (this.connections.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /** Push an event to every connection subscribed to its channel. */
  emit(event: RealtimeEvent) {
    const set = this.subscribers.get(event.channel);
    if (!set || set.size === 0) return;
    const frame = JSON.stringify({
      kind: event.kind,
      channel: event.channel,
      payload: event.payload ?? null,
      ts: Date.now(),
    });
    for (const sock of set) {
      try {
        sock.send(frame);
      } catch {
        // Drop the socket on send failure — the close handler will
        // tidy up subscriptions.
        this.detach(sock);
      }
    }
  }

  /** Idle ping — drops sockets that haven't responded in 60s.
   *  The browser ws client also sends its own pings, which is the
   *  primary keep-alive; this is belt-and-braces. */
  private startHeartbeat() {
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      for (const [sock, conn] of this.connections) {
        if (now - conn.lastSeen > 90_000) {
          try {
            sock.close(1001, "idle");
          } catch {
            /* ignore */
          }
          this.detach(sock);
          continue;
        }
        try {
          sock.ping?.();
        } catch {
          this.detach(sock);
        }
      }
    }, 30_000);
  }

  private send(socket: WSLike, body: Record<string, unknown>) {
    try {
      socket.send(JSON.stringify(body));
    } catch {
      this.detach(socket);
    }
  }

  /** Channel ACL — every channel must start with `tenant:{tenantId}`
   *  matching the connection's authenticated tenant. */
  private canSubscribe(conn: ConnectionState, channel: string): boolean {
    const prefix = `tenant:${conn.tenantId}`;
    return channel === prefix || channel.startsWith(`${prefix}:`);
  }
}

const hub = new RealtimeHub();

/** Module-level emit — called by route handlers. Cheap when no
 *  subscribers are listening. */
export function emit(event: RealtimeEvent) {
  hub.emit(event);
}

/** Channel name builders. Centralizing them avoids typos at call
 *  sites and lets the spec evolve in one place. */
export const channels = {
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  user: (tenantId: string, userId: string) =>
    `tenant:${tenantId}:user:${userId}`,
  project: (tenantId: string, projectId: string) =>
    `tenant:${tenantId}:project:${projectId}`,
  card: (tenantId: string, cardId: string) =>
    `tenant:${tenantId}:card:${cardId}`,
  cmsSite: (tenantId: string, siteId: string) =>
    `tenant:${tenantId}:cms:${siteId}`,
  exports: (tenantId: string) => `tenant:${tenantId}:exports`,
  validation: (tenantId: string) => `tenant:${tenantId}:validation`,
  playtest: (tenantId: string, sessionId: string) =>
    `tenant:${tenantId}:playtest:${sessionId}`,
};

/** Top-level registration of `@fastify/websocket`. Must be added at
 *  the root scope BEFORE any encapsulated child registers a `/ws`
 *  route, otherwise the plugin's HTTP upgrade hook attaches to a
 *  subset of the server and ordinary HTTP requests get killed at
 *  the upgrade layer (manifests as `ERR_EMPTY_RESPONSE` on every
 *  fetch). server.ts calls this before the tenant-scoped block. */
export const registerWebsocketSupport = fp(async function wsSupport(
  fastify: FastifyInstance,
) {
  await fastify.register(websocketPlugin, {
    options: { maxPayload: 1_048_576 /* 1 MiB */ },
  });
});

/** Fastify plugin — wires the upgrade endpoint at `/ws`. */
export default fp(async function realtimePlugin(fastify: FastifyInstance) {
  fastify.get(
    "/ws",
    { websocket: true },
    async (connection, request: FastifyRequest) => {
      // Auth — resolve the JWT from the query string. Browser
      // WebSocket connect doesn't allow custom headers, so a token
      // query param is the standard pattern.
      const tokenRaw = (request.query as Record<string, unknown> | undefined)
        ?.token;
      const token = typeof tokenRaw === "string" ? tokenRaw : null;

      let userId: string | null = null;
      if (token) {
        try {
          const decoded = await fastify.jwt.verify<{
            sub?: string;
            id?: string;
          }>(token);
          userId = decoded.sub ?? decoded.id ?? null;
        } catch {
          userId = null;
        }
      }
      if (!userId) {
        connection.socket.close(4401, "unauthorized");
        return;
      }

      // Tenant context — pulled from the same hostname resolver the
      // REST routes use. Every WS connection is bound to a single
      // tenant for its lifetime; switching tenants on the client
      // closes and reconnects.
      const tenantId =
        (request as FastifyRequest & {
          tenant?: { tenantId: string };
        }).tenant?.tenantId ?? null;
      if (!tenantId) {
        connection.socket.close(4400, "no_tenant");
        return;
      }

      // Membership check — guards against a stolen token being
      // upgraded against a tenant the user no longer belongs to.
      const member = await fastify.prisma.membership.findFirst({
        where: { userId, tenantId },
        select: { id: true },
      });
      if (!member) {
        connection.socket.close(4403, "forbidden");
        return;
      }

      hub.attach(connection.socket as unknown as WSLike, {
        tenantId,
        userId,
      });
    },
  );
});
