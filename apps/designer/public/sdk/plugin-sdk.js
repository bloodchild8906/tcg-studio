/**
 * TCGStudio Plugin SDK (sec 34) — runtime build.
 *
 * Plain JS so plugin iframes can `import { plugin } from "/sdk/plugin-sdk.js"`
 * without a build step. The TypeScript source lives in
 * `apps/designer/src/plugin-sdk/index.ts`; keep this file in sync.
 *
 * Wraps the host's postMessage RPC bridge so plugin authors can write:
 *
 *   import { plugin } from "/sdk/plugin-sdk.js";
 *   const init = await plugin.ready();
 *   const cards = await plugin.call("cards.list", { projectId: init.hostContext.projectId });
 *   plugin.toast("Hello!");
 *
 * No dependencies, no exports beyond `plugin`.
 */

const CHANNEL = "tcgstudio.plugin.v1";

class PluginClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.contextSubs = new Set();
    this.cachedInit = null;
    this.readyPromise = null;
    this.listenerInstalled = false;
  }

  ready() {
    if (this.cachedInit) return Promise.resolve(this.cachedInit);
    if (this.readyPromise) return this.readyPromise;
    this.installListener();
    this.readyPromise = new Promise((resolve) => {
      this.postEvent("ready");
      const off = this.onInit((payload) => {
        off();
        resolve(payload);
      });
    });
    return this.readyPromise;
  }

  onContext(fn) {
    this.contextSubs.add(fn);
    if (this.cachedInit) fn(this.cachedInit.hostContext);
    return () => this.contextSubs.delete(fn);
  }

  call(method, params = {}) {
    this.installListener();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.parent.postMessage(
        { channel: CHANNEL, id, kind: "rpc", method, params },
        "*",
      );
    });
  }

  toast(text) {
    this.call("ui.toast", { text }).catch(() => {});
  }

  onInit(fn) {
    const handler = (e) => {
      const env = e.data;
      if (!env || env.channel !== CHANNEL || env.kind !== "init") return;
      const payload = {
        manifest: env.manifest,
        hostContext: env.hostContext,
      };
      this.cachedInit = payload;
      for (const sub of this.contextSubs) sub(payload.hostContext);
      fn(payload);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }

  installListener() {
    if (this.listenerInstalled) return;
    this.listenerInstalled = true;
    window.addEventListener("message", (e) => {
      const env = e.data;
      if (!env || env.channel !== CHANNEL) return;
      if (env.kind === "rpc.response") {
        const slot = this.pending.get(env.id);
        if (!slot) return;
        this.pending.delete(env.id);
        if (env.error) {
          const err = new Error(env.error.message);
          err.code = env.error.code;
          slot.reject(err);
        } else {
          slot.resolve(env.result);
        }
      } else if (env.kind === "init") {
        this.cachedInit = {
          manifest: env.manifest,
          hostContext: env.hostContext,
        };
        for (const sub of this.contextSubs) sub(this.cachedInit.hostContext);
      }
    });
  }

  postEvent(event, payload = {}) {
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

export const plugin = new PluginClient();
