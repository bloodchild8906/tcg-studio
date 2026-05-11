/**
 * Plugin runtime protocol (sec 34).
 *
 * Defines the message shape the host and a sandboxed plugin iframe
 * exchange. Both sides import this file so the wire format stays
 * single-sourced.
 *
 * Messages flow over `postMessage`. Each request carries a numeric
 * `id` so the host can reply asynchronously without forcing the
 * plugin to await a fixed sequence. Replies have no `method` and
 * carry either `result` or `error`.
 *
 * v0 keeps the surface intentionally tiny — the spec lists many
 * capabilities but real adoption needs a working baseline first.
 * Adding a new method here is a single file edit on each side.
 */

/** Common envelope. */
export interface PluginMessage {
  /** Cooperative protocol marker so other postMessage chatter can
   *  be ignored by both ends. */
  channel: "tcgstudio.plugin.v1";
  /** Correlation id assigned by the requester. Replies echo it. */
  id: number;
}

/** Host → plugin: bootstrap hello once the iframe loads. */
export interface PluginInitRequest extends PluginMessage {
  kind: "init";
  manifest: PluginManifest;
  /** Snapshot of the host context the plugin can read synchronously
   *  without a round-trip. Tenant + project ids, current view,
   *  feature flags. */
  hostContext: {
    tenantId: string;
    tenantSlug: string;
    projectId: string | null;
    projectSlug: string | null;
    locale: string;
    /** Permissions the host has decided to grant this plugin install
     *  based on its manifest + plan tier. */
    grantedPermissions: string[];
  };
}

/** Plugin → host: an RPC call. */
export interface PluginRpcRequest extends PluginMessage {
  kind: "rpc";
  method: PluginRpcMethod;
  params: Record<string, unknown>;
}

/** Either side: a response to a previously seen `id`. */
export interface PluginRpcResponse extends PluginMessage {
  kind: "rpc.response";
  result?: unknown;
  error?: { code: string; message: string };
}

/** Plugin → host: a fire-and-forget event (telemetry, ready signal). */
export interface PluginEvent extends PluginMessage {
  kind: "event";
  event: string;
  payload?: Record<string, unknown>;
}

export type PluginEnvelope =
  | PluginInitRequest
  | PluginRpcRequest
  | PluginRpcResponse
  | PluginEvent;

/** Host RPC surface — narrow on purpose. Add capabilities here as
 *  plugins need them; the manifest must list the corresponding
 *  permission for each call to succeed. */
export type PluginRpcMethod =
  | "host.getContext"
  | "cards.list"
  | "cards.get"
  | "assets.list"
  | "notifications.send"
  | "exports.create"
  | "ui.toast";

/** Bare-bones manifest shape the host validates at install time.
 *  Mirrors the shape stored in `Plugin.manifestJson`. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Capability strings — `read:cards`, `write:exports`, etc. */
  permissions: string[];
  /** UI surfaces the plugin contributes. v0 supports a single
   *  `panel` surface that mounts inside the designer's right rail
   *  via the plugin manager. */
  uiContributions?: PluginUiContribution[];
  /** Background entry — pure logic plugin without UI. v0 still
   *  requires an iframe (we keep a hidden one) so the same RPC
   *  channel works regardless. */
  entryUrl?: string;
}

export interface PluginUiContribution {
  kind: "panel";
  id: string;
  label: string;
  /** URL inside the plugin bundle that the iframe loads. The host
   *  rewrites relative URLs against the plugin's storage prefix. */
  entry: string;
  /** Optional icon name (lucide-style). */
  icon?: string;
}
