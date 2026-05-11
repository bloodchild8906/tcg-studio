/**
 * Plugin host runtime (sec 34).
 *
 * Manages the lifecycle of every enabled plugin in a tenant:
 *
 *   1. Build a sandboxed iframe per plugin install.
 *   2. Wait for the plugin to send `event: "ready"`.
 *   3. Send the `init` envelope with manifest + host context.
 *   4. Service RPC calls from the plugin against host APIs, gated
 *      by the permission set we computed at install time.
 *   5. Tear down on uninstall / app reload.
 *
 * Sandboxing — the iframe uses `sandbox="allow-scripts"` only. No
 * same-origin, no top-navigation, no forms. The plugin can fetch
 * external URLs at its own origin but cannot read host cookies,
 * localStorage, or DOM. All host data flows through `postMessage`.
 *
 * RPC dispatch — every method is registered in `HOST_RPC` with the
 * permission(s) it requires. A call without the right permission
 * returns `{ error: { code: "permission_denied", message } }`.
 *
 * Why client-side sandboxing for v0 — running plugin code on the
 * server requires V8 isolates / wasm and a much bigger ops surface.
 * Browser iframes give us safe execution today and let plugins ship
 * real UI. Server-side sandboxing lands when we need cron-style
 * background plugins (sec 38).
 */

import type {
  PluginEnvelope,
  PluginEvent,
  PluginInitRequest,
  PluginManifest,
  PluginRpcMethod,
  PluginRpcRequest,
  PluginRpcResponse,
} from "./protocol";

const CHANNEL = "tcgstudio.plugin.v1";

/** A plugin install we know how to mount. The host queries
 *  `/api/v1/plugins/installs` and converts each row to one of these. */
export interface PluginInstance {
  installId: string;
  pluginId: string;
  manifest: PluginManifest;
  /** Permissions this install actually has, after intersecting the
   *  manifest's request with the plan's allow-list. */
  grantedPermissions: string[];
}

/** A single RPC handler registered by the host. */
type RpcHandler = (
  params: Record<string, unknown>,
  ctx: { instance: PluginInstance },
) => Promise<unknown> | unknown;

/** Methods the plugin can call on the host. Each entry declares the
 *  permissions required and the handler. v0 is intentionally narrow
 *  — the surface grows alongside real-world plugin needs. */
const HOST_RPC: Record<
  PluginRpcMethod,
  { permissions: string[]; handler: RpcHandler }
> = {
  "host.getContext": {
    permissions: [],
    handler: () => ({ ok: true }),
  },
  "cards.list": {
    permissions: ["read:cards"],
    handler: async (params) => {
      const { listCards } = await import("@/lib/api");
      return listCards({
        projectId: typeof params.projectId === "string" ? params.projectId : undefined,
      });
    },
  },
  "cards.get": {
    permissions: ["read:cards"],
    handler: async (params) => {
      if (typeof params.id !== "string") throw new RpcError("bad_params");
      const { getCard } = await import("@/lib/api");
      return getCard(params.id);
    },
  },
  "assets.list": {
    permissions: ["read:assets"],
    handler: async (params) => {
      const { listAssets } = await import("@/lib/api");
      return listAssets({
        projectId: typeof params.projectId === "string" ? params.projectId : undefined,
        limit: 200,
      });
    },
  },
  "notifications.send": {
    permissions: ["write:notifications"],
    handler: () => {
      // v0: no-op. Real implementation calls the notifications
      // endpoint scoped to the tenant. We don't trust the plugin to
      // address users by id, so the host resolves the recipient
      // from the active session.
      return { ok: true };
    },
  },
  "exports.create": {
    permissions: ["write:exports"],
    handler: () => {
      return { ok: true };
    },
  },
  "ui.toast": {
    permissions: [],
    handler: (params) => {
      // Toasts are a UX courtesy, not a security boundary, so we
      // allow them with no special permission. We just gate length
      // so a misbehaving plugin can't cover the screen.
      const text =
        typeof params.text === "string" ? params.text.slice(0, 200) : "";
      if (text) {
        // The toast bus is wired up by the app shell.
        try {
          window.dispatchEvent(
            new CustomEvent("tcgs:toast", { detail: { text } }),
          );
        } catch {
          // ignore — environments without DOM
        }
      }
      return { ok: true };
    },
  },
};

class RpcError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** Runtime singleton — one per tab. */
class PluginHost {
  private instances = new Map<string, PluginInstance>();
  private frames = new Map<string, HTMLIFrameElement>();
  private listenerInstalled = false;

  /** Mount each plugin install. Idempotent — calling twice on the
   *  same install just re-uses the existing iframe. */
  async mount(instance: PluginInstance, parent: HTMLElement) {
    this.installListener();

    if (this.frames.has(instance.installId)) return;

    const iframe = document.createElement("iframe");
    iframe.dataset.pluginInstall = instance.installId;
    iframe.title = `Plugin: ${instance.manifest.name}`;
    iframe.style.border = "0";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    // The sandbox attribute is the linchpin. allow-scripts only —
    // no same-origin, no forms, no popups, no top navigation.
    iframe.setAttribute("sandbox", "allow-scripts");

    const url = resolveEntry(instance);
    if (!url) {
      // No entry point — keep the iframe out of the DOM, but record
      // the instance so RPC can still service plugins that contribute
      // through other surfaces (e.g. background-only plugins).
      this.instances.set(instance.installId, instance);
      return;
    }

    iframe.src = url;
    parent.appendChild(iframe);
    this.frames.set(instance.installId, iframe);
    this.instances.set(instance.installId, instance);
  }

  /** Tear down. Drops the iframe and forgets the instance. */
  unmount(installId: string) {
    const f = this.frames.get(installId);
    if (f) {
      f.remove();
      this.frames.delete(installId);
    }
    this.instances.delete(installId);
  }

  /** List of mounted instances — used by the plugin manager UI to
   *  render diagnostics. */
  list(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  private installListener() {
    if (this.listenerInstalled) return;
    this.listenerInstalled = true;
    window.addEventListener("message", (e) => this.handleMessage(e));
  }

  private async handleMessage(e: MessageEvent) {
    const data = e.data as unknown;
    if (!isPluginMessage(data)) return;

    // Identify which plugin sent this.
    const senderId = this.identifySender(e.source as Window | null);
    if (!senderId) return;
    const instance = this.instances.get(senderId);
    if (!instance) return;

    if (data.kind === "event") {
      this.handleEvent(instance, data);
      return;
    }
    if (data.kind === "rpc") {
      const reply = await this.handleRpc(instance, data);
      this.postReply(senderId, reply);
      return;
    }
    // Replies / init are host-originated; ignore inbound.
  }

  private handleEvent(instance: PluginInstance, env: PluginEvent) {
    if (env.event === "ready") {
      // Plugin signaled it's listening — send the init envelope.
      const init: PluginInitRequest = {
        channel: CHANNEL,
        id: 0,
        kind: "init",
        manifest: instance.manifest,
        hostContext: this.snapshotContext(instance),
      };
      this.post(instance.installId, init);
    }
    // Other events are reserved — we ignore unknowns by design.
  }

  private async handleRpc(
    instance: PluginInstance,
    env: PluginRpcRequest,
  ): Promise<PluginRpcResponse> {
    const spec = HOST_RPC[env.method];
    if (!spec) {
      return reply(env.id, {
        error: { code: "unknown_method", message: env.method },
      });
    }
    for (const perm of spec.permissions) {
      if (!instance.grantedPermissions.includes(perm)) {
        return reply(env.id, {
          error: {
            code: "permission_denied",
            message: `requires "${perm}"`,
          },
        });
      }
    }
    try {
      const result = await spec.handler(env.params ?? {}, { instance });
      return reply(env.id, { result });
    } catch (err) {
      const code = err instanceof RpcError ? err.code : "internal";
      const message =
        err instanceof Error ? err.message : "Plugin RPC failed.";
      return reply(env.id, { error: { code, message } });
    }
  }

  /** Last snapshot of host state, refreshed by `setHostState` from
   *  the app shell. Decoupled from the store import so this module
   *  stays leaf-imported and doesn't pull the entire designer chunk
   *  into every plugin host bundle. */
  private hostState: DesignerStateLike = {};
  setHostState(state: DesignerStateLike) {
    this.hostState = state;
  }

  private snapshotContext(instance: PluginInstance) {
    const s = this.hostState;
    const tenant = s.tenants?.find?.((t) => t.slug === s.activeTenantSlug);
    const project = s.projects?.find?.((p) => p.id === s.activeProjectId);
    return {
      tenantId: tenant?.id ?? "",
      tenantSlug: s.activeTenantSlug ?? "",
      projectId: project?.id ?? null,
      projectSlug: project?.slug ?? null,
      locale: typeof navigator !== "undefined" ? navigator.language : "en",
      grantedPermissions: instance.grantedPermissions,
    };
  }

  private identifySender(source: Window | null): string | null {
    if (!source) return null;
    for (const [id, frame] of this.frames) {
      if (frame.contentWindow === source) return id;
    }
    return null;
  }

  private post(installId: string, env: PluginEnvelope) {
    const frame = this.frames.get(installId);
    if (!frame || !frame.contentWindow) return;
    // Plugins live on a different origin. We use "*" because the
    // sandbox attribute already enforces isolation; the listener on
    // the plugin side validates the channel marker.
    frame.contentWindow.postMessage(env, "*");
  }

  private postReply(installId: string, reply: PluginRpcResponse) {
    this.post(installId, reply);
  }
}

export interface DesignerStateLike {
  tenants?: Array<{ id: string; slug: string }>;
  projects?: Array<{ id: string; slug: string }>;
  activeTenantSlug?: string;
  activeProjectId?: string | null;
}

function reply(
  id: number,
  body: { result?: unknown; error?: { code: string; message: string } },
): PluginRpcResponse {
  return {
    channel: CHANNEL,
    id,
    kind: "rpc.response",
    ...body,
  };
}

function isPluginMessage(x: unknown): x is PluginEnvelope {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { channel?: unknown }).channel === CHANNEL &&
    typeof (x as { id?: unknown }).id === "number" &&
    typeof (x as { kind?: unknown }).kind === "string"
  );
}

function resolveEntry(instance: PluginInstance): string | null {
  const ui = instance.manifest.uiContributions ?? [];
  if (ui.length > 0) return ui[0].entry;
  if (instance.manifest.entryUrl) return instance.manifest.entryUrl;
  return null;
}

export const pluginHost = new PluginHost();
