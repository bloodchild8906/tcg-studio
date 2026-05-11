/**
 * Realtime WebSocket client (sec 37).
 *
 * One singleton connection per tab. Subscribers register a channel
 * they care about plus a callback for incoming events on that
 * channel. The client opens the WS lazily on the first subscribe
 * and tears it down when nobody is listening anymore.
 *
 * Reconnect policy: exponential backoff capped at 30s. On reconnect
 * we replay every active subscription so callers don't have to
 * re-subscribe themselves.
 *
 * Auth: the JWT in localStorage (via `getAuthToken()`) goes on the
 * connect URL as `?token=…`. Tenant context is resolved server-side
 * from the same hostname rules REST uses.
 *
 * Why a class wrapper over `new WebSocket(url)`: we want a single
 * shared connection across the whole app (NotificationBell + active
 * card review drawer + export job tickers + future plugins all share
 * one socket), and we want subscriptions to survive reconnects.
 */

import { apiHealth, getAuthToken } from "@/lib/api";

type Listener = (event: RealtimeEvent) => void;

export interface RealtimeEvent {
  kind: string;
  channel: string;
  payload: Record<string, unknown> | null;
  ts: number;
}

class RealtimeClient {
  private ws: WebSocket | null = null;
  /** channel → set of listeners. */
  private listeners = new Map<string, Set<Listener>>();
  /** channels we've successfully subscribed to on the current
   *  socket. Cleared on close, replayed on reconnect. */
  private confirmed = new Set<string>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lazy connect — true once any subscriber has registered. */
  private wantOpen = false;

  /** Subscribe to a channel. Returns an unsubscribe — the underlying
   *  socket-level `unsubscribe` only fires when the last listener
   *  drops. */
  subscribe(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);

    this.wantOpen = true;
    this.ensureConnection();
    if (this.ws?.readyState === WebSocket.OPEN && !this.confirmed.has(channel)) {
      this.send({ type: "subscribe", channel });
    }

    return () => {
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) {
        this.listeners.delete(channel);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({ type: "unsubscribe", channel });
        }
        this.confirmed.delete(channel);
      }
      // React StrictMode runs effect cleanups twice in development —
      // once immediately after mount, then again on real unmount. The
      // first cleanup fires before the WS finishes its handshake,
      // which would close a still-OPENING socket. We defer the
      // teardown by a tick so a fresh subscribe (StrictMode's
      // re-mount) cancels the close before it lands.
      if (this.listeners.size === 0) {
        this.wantOpen = false;
        setTimeout(() => {
          if (this.listeners.size === 0 && !this.wantOpen) {
            this.close();
          }
        }, 0);
      }
    };
  }

  private ensureConnection() {
    if (this.ws) return;
    if (!this.wantOpen) return;

    const token = getAuthToken();
    if (!token) {
      // Without a token the connect would 4401 immediately. Try
      // again later — caller will keep `wantOpen` true.
      this.scheduleReconnect();
      return;
    }
    const url = this.buildUrl(token);
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Replay every active subscription. The hub treats subscribe
      // as idempotent so this is safe even if some channels were
      // already confirmed before a flap.
      for (const ch of this.listeners.keys()) {
        this.send({ type: "subscribe", channel: ch });
      }
    };

    this.ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws.onclose = () => {
      this.ws = null;
      this.confirmed.clear();
      if (this.wantOpen) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      // The close handler will fire next; reconnect runs there.
    };
  }

  private buildUrl(token: string): string {
    // Derive the WS URL from the same `API_BASE` the REST client uses
    // (`apiHealth.base`, defaulting to `VITE_API_URL` or
    // http://localhost:4000). Earlier we tried to compute the API
    // host from the current window.location, but that picked up
    // Vite's port (5173) instead of the API's (4000) and produced
    // dead WS URLs like `ws://api.tcgstudio.local:5173/ws`.
    if (typeof window === "undefined") return "";
    const base = apiHealth.base || "http://localhost:4000";
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      return "";
    }
    const proto = url.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${url.host}/ws?token=${encodeURIComponent(token)}`;
  }

  private handleMessage(raw: string) {
    let frame: Record<string, unknown> | null = null;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;
    const kind = String(frame.kind ?? "");
    const channel = String(frame.channel ?? "");

    if (kind === "subscribed" && channel) {
      this.confirmed.add(channel);
      return;
    }
    if (kind === "hello" || kind === "pong") return;
    if (kind === "error") return;

    if (!channel) return;
    const set = this.listeners.get(channel);
    if (!set) return;
    const event: RealtimeEvent = {
      kind,
      channel,
      payload: (frame.payload as Record<string, unknown> | null) ?? null,
      ts: typeof frame.ts === "number" ? (frame.ts as number) : Date.now(),
    };
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        /* swallow — one listener bug shouldn't kill the bus. */
      }
    }
  }

  private send(frame: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      /* will retry on reconnect */
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnection();
    }, delay);
  }

  private close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client_done");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.confirmed.clear();
  }
}

export const realtime = new RealtimeClient();

/** Channel name builders, mirrored from `apps/api/src/plugins/realtime.ts`. */
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
  playtest: (tenantId: string, sessionId: string) =>
    `tenant:${tenantId}:playtest:${sessionId}`,
};
