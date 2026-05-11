/**
 * TCGStudio Plugin SDK (sec 34).
 *
 * The author-facing wrapper around the postMessage RPC bridge. A
 * plugin imports this from inside its iframe and gets:
 *
 *   • `ready()`        — signal "I'm listening" to the host. Returns
 *                        a Promise that resolves with the init blob
 *                        (manifest + host context + permissions).
 *   • `call(method, params?)` — typed RPC. Resolves with the result
 *                        or throws an Error carrying `{ code, message }`.
 *   • `toast(text)`    — shorthand for `ui.toast`. Fire-and-forget.
 *   • `onContext(fn)`  — subscribe to host context updates the host
 *                        pushes after init (active project change,
 *                        tenant switch). v0 only fires on init.
 *
 * Why a tiny module instead of a npm package: plugins are small,
 * static asset bundles. Authors can either inline this file directly
 * or fetch it from the platform CDN at /sdk/plugin-sdk.js. Either
 * way it stays under 2KB minified and has zero dependencies.
 */

interface SdkEnvelope {
  channel: "tcgstudio.plugin.v1";
  id: number;
  kind: string;
  [k: string]: unknown;
}

interface InitPayload {
  manifest: PluginManifestLite;
  hostContext: HostContext;
}

export interface HostContext {
  tenantId: string;
  tenantSlug: string;
  projectId: string | null;
  projectSlug: string | null;
  locale: string;
  grantedPermissions: string[];
}

export interface PluginManifestLite {
  id: string;
  name: string;
  version: string;
  permissions: string[];
}

const CHANNEL = "tcgstudio.plugin.v1";

/** Install a single message listener and route both replies + init
 *  through a small dispatcher. Single-instance: calling `ready()`
 *  twice is a no-op for the listener install but resolves with the
 *  same cached init payload. */
class PluginClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private contextSubs = new Set<(ctx: HostContext) => void>();
  private cachedInit: InitPayload | null = null;
  private readyPromise: Promise<InitPayload> | null = null;
  private listenerInstalled = false;

  /** Wait for the host to send the `init` envelope. Idempotent. */
  ready(): Promise<InitPayload> {
    if (this.cachedInit) return Promise.resolve(this.cachedInit);
    if (this.readyPromise) return this.readyPromise;

    this.installListener();
    this.readyPromise = new Promise<InitPayload>((resolve) => {
      // Tell the host we're ready to receive `init`. Reply listener
      // below will resolve.
      this.postEvent("ready");
      const off = this.onInit((payload) => {
        off();
        resolve(payload);
      });
    });
    return this.readyPromise;
  }

  /** Subscribe to all init/context-update payloads. Returns an
   *  unsubscribe. */
  onContext(fn: (ctx: HostContext) => void): () => void {
    this.contextSubs.add(fn);
    if (this.cachedInit) fn(this.cachedInit.hostContext);
    return () => this.contextSubs.delete(fn);
  }

  /** Make an RPC call. Resolves with the result, rejects with an
   *  Error carrying `code` on the cause. */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.installListener();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      window.parent.postMessage(
        { channel: CHANNEL, id, kind: "rpc", method, params },
        "*",
      );
    });
  }

  /** Toast — fire and forget. Won't reject. */
  toast(text: string): void {
    void this.call("ui.toast", { text }).catch(() => {
      /* swallow — toasts are courtesy. */
    });
  }

  /** Internal: register an init listener. The first init resolves
   *  ready(); later inits (for context refreshes) re-fire `onContext`
   *  subscribers. */
  private onInit(fn: (payload: InitPayload) => void): () => void {
    const handler = (e: MessageEvent) => {
      const env = e.data as SdkEnvelope | undefined;
      if (!env || env.channel !== CHANNEL || env.kind !== "init") return;
      const payload: InitPayload = {
        manifest: env.manifest as PluginManifestLite,
        hostContext: env.hostContext as HostContext,
      };
      this.cachedInit = payload;
      for (const sub of this.contextSubs) sub(payload.hostContext);
      fn(payload);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }

  private installListener() {
    if (this.listenerInstalled) return;
    this.listenerInstalled = true;
    window.addEventListener("message", (e) => {
      const env = e.data as SdkEnvelope | undefined;
      if (!env || env.channel !== CHANNEL) return;
      if (env.kind === "rpc.response") {
        const slot = this.pending.get(env.id);
        if (!slot) return;
        this.pending.delete(env.id);
        const err = (env as { error?: { code: string; message: string } }).error;
        if (err) {
          const e = new Error(err.message);
          (e as Error & { code?: string }).code = err.code;
          slot.reject(e);
        } else {
          slot.resolve((env as { result?: unknown }).result);
        }
      } else if (env.kind === "init") {
        this.cachedInit = {
          manifest: env.manifest as PluginManifestLite,
          hostContext: env.hostContext as HostContext,
        };
        for (const sub of this.contextSubs) sub(this.cachedInit.hostContext);
      }
    });
  }

  private postEvent(event: string, payload: Record<string, unknown> = {}) {
    window.parent.postMessage(
      {
        channel: CHANNEL,
        id: this.nextId++,
        kind: "event",
        event,
        payload,
      },
      "*",
    );
  }
}

/** Default export — most plugins only need one instance. */
export const plugin = new PluginClient();
