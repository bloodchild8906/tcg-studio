import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { Plugin, PluginInstall } from "@/lib/api";
import { PluginPanelHost } from "@/plugin-runtime/PluginPanelHost";
import type { PluginInstance } from "@/plugin-runtime/host";
import type {
  PluginManifest,
  PluginUiContribution,
} from "@/plugin-runtime/protocol";

/**
 * Plugin manager (sec 34).
 *
 * v1 — pairs the catalog UX from v0 with the actual runtime: installs
 * that declare a `panel` UI contribution mount inside an isolated
 * iframe via `PluginPanelHost`. The host applies postMessage RPC
 * gating from the manifest's permission set so a misbehaving plugin
 * can't reach beyond what its manifest declares.
 *
 * Layout when something is installed:
 *
 *   ┌──────────────── Plugins ────────────────┐
 *   │ Catalog grid                            │
 *   │ Active plugin panels (one per install)  │
 *   └─────────────────────────────────────────┘
 *
 * Toast bus — the runtime emits `tcgs:toast` CustomEvents from
 * `ui.toast` calls. We listen here and surface them as a transient
 * banner. Real notification routing lands when the notifications
 * RPC ships.
 */
export function PluginsSection() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [installs, setInstalls] = useState<PluginInstall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [p, i] = await Promise.all([
        api.listPlugins(),
        api.listPluginInstalls(),
      ]);
      setPlugins(p);
      setInstalls(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Toast listener — the plugin runtime fires a CustomEvent on
  // `ui.toast` calls; we render the latest as a small banner that
  // auto-dismisses after 4 seconds.
  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (detail?.text) {
        setToast(detail.text);
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
      }
    }
    window.addEventListener("tcgs:toast", onToast);
    return () => window.removeEventListener("tcgs:toast", onToast);
  }, []);

  const installedById = new Map(installs.map((i) => [i.pluginId, i]));

  /**
   * Convert each enabled install whose manifest declares a UI
   * contribution into a `PluginInstance` for the runtime.
   *
   * Permissions: we treat the manifest's declared permissions as the
   * granted set in v0. The marketplace install path will compute the
   * actual intersection against the tenant's plan; until that lands
   * the manifest declaration is the source of truth.
   */
  const panelInstances = useMemo<PluginInstance[]>(() => {
    return installs
      .filter((inst) => inst.enabled)
      .map((inst): PluginInstance | null => {
        const manifest = parseManifest(inst.plugin);
        if (!manifest) return null;
        const ui = manifest.uiContributions ?? [];
        if (!ui.some((c) => c.kind === "panel")) return null;
        return {
          installId: inst.id,
          pluginId: inst.pluginId,
          manifest,
          grantedPermissions: manifest.permissions ?? [],
        };
      })
      .filter((x): x is PluginInstance => x !== null);
  }, [installs]);

  async function installOne(p: Plugin) {
    await api.installPlugin(p.id);
    await refresh();
  }
  async function uninstall(p: Plugin) {
    if (!confirm(`Uninstall ${p.name}? Any tenant settings on this plugin are lost.`))
      return;
    await api.uninstallPlugin(p.id);
    await refresh();
  }
  async function toggle(install: PluginInstall) {
    await api.updatePluginInstall(install.id, { enabled: !install.enabled });
    await refresh();
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3">
        <h3 className="text-sm font-medium text-ink-100">Plugins</h3>
        <p className="text-[11px] text-ink-500">
          Extend TCGStudio with curated add-ons — exporters, ability node
          packs, custom CMS blocks, and more. Catalog is platform-wide;
          installs and settings live per tenant.
        </p>
      </header>

      {toast && (
        <div className="mb-3 rounded border border-accent-500/40 bg-accent-500/10 px-3 py-1.5 text-xs text-accent-200">
          {toast}
        </div>
      )}

      {error && (
        <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-4 text-center text-sm text-ink-500">Loading…</p>
      ) : plugins.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">
          The plugin catalog is empty. The platform owner can publish
          plugins to make them appear here.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {plugins.map((p) => {
            const install = installedById.get(p.id) ?? null;
            const manifest = parseManifest(p);
            const surfaces = manifest?.uiContributions ?? [];
            return (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded border border-ink-800 bg-ink-900/40 p-3"
              >
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-100">
                    {p.name}
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                      v{p.version}
                    </span>
                    {install && (
                      <span
                        className={[
                          "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                          install.enabled
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-ink-800 text-ink-400",
                        ].join(" ")}
                      >
                        {install.enabled ? "enabled" : "disabled"}
                      </span>
                    )}
                  </p>
                  {p.author && (
                    <p className="text-[11px] text-ink-500">by {p.author}</p>
                  )}
                  {p.description && (
                    <p className="mt-1 text-xs text-ink-300">
                      {p.description}
                    </p>
                  )}
                  {(manifest?.permissions?.length ?? 0) > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-500">
                      {manifest!.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="rounded border border-ink-800 bg-ink-950 px-1 py-0.5 font-mono"
                        >
                          {perm}
                        </span>
                      ))}
                    </p>
                  )}
                  {surfaces.length > 0 && (
                    <p className="mt-1 text-[10px] text-ink-500">
                      Surfaces:{" "}
                      <span className="text-ink-300">
                        {surfaces.map((s) => s.label).join(", ")}
                      </span>
                    </p>
                  )}
                </div>
                <div className="mt-auto flex items-center gap-2">
                  {!install ? (
                    <button
                      type="button"
                      onClick={() => installOne(p)}
                      className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
                    >
                      Install
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggle(install)}
                        className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700"
                      >
                        {install.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => uninstall(p)}
                        className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs text-danger-400 hover:bg-danger-500/20"
                      >
                        Uninstall
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {panelInstances.length > 0 && (
        <section className="mt-6 space-y-3">
          <header className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-ink-200">
              Active panels
            </h4>
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              Sandboxed
            </p>
          </header>
          <p className="text-[11px] text-ink-500">
            Each plugin runs inside an isolated iframe. The host enforces
            permissions on every RPC call so a plugin only sees what its
            manifest declares.
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {panelInstances.map((inst) => (
              <article
                key={inst.installId}
                className="overflow-hidden rounded border border-ink-800 bg-ink-950"
              >
                <header className="flex items-center justify-between border-b border-ink-800 px-3 py-1.5 text-[11px]">
                  <span className="text-ink-200">{inst.manifest.name}</span>
                  <span className="text-ink-500">
                    {inst.manifest.uiContributions?.[0]?.label ?? "panel"}
                  </span>
                </header>
                <div className="h-[360px]">
                  <PluginPanelHost instance={inst} />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

/**
 * Validate-and-parse the manifest blob from the API into the typed
 * shape the runtime expects. Returns null when the manifest is
 * missing required fields — the install is still listable, but its
 * panel contributions are skipped.
 */
function parseManifest(plugin: Plugin): PluginManifest | null {
  const m = plugin.manifestJson;
  if (!m || typeof m !== "object") return null;
  const obj = m as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : plugin.slug;
  const name = typeof obj.name === "string" ? obj.name : plugin.name;
  const version = typeof obj.version === "string" ? obj.version : plugin.version;
  const permissions = Array.isArray(obj.permissions)
    ? obj.permissions.filter((x): x is string => typeof x === "string")
    : [];
  const ui = Array.isArray(obj.uiContributions)
    ? obj.uiContributions
        .filter(
          (
            c,
          ): c is Record<string, unknown> => typeof c === "object" && c !== null,
        )
        .map((c): PluginUiContribution | null => {
          const kind = typeof c.kind === "string" ? c.kind : null;
          const cid = typeof c.id === "string" ? c.id : null;
          const label = typeof c.label === "string" ? c.label : null;
          const entry = typeof c.entry === "string" ? c.entry : null;
          if (kind !== "panel" || !cid || !label || !entry) return null;
          return {
            kind: "panel",
            id: cid,
            label,
            entry,
            icon: typeof c.icon === "string" ? c.icon : undefined,
          };
        })
        .filter((x): x is PluginUiContribution => x !== null)
    : [];
  const entryUrl = typeof obj.entryUrl === "string" ? obj.entryUrl : undefined;

  return {
    id,
    name,
    version,
    permissions,
    uiContributions: ui.length > 0 ? ui : undefined,
    entryUrl,
  };
}
