import { useState } from "react";
import { useDesigner } from "@/store/designerStore";
import { availableLocales } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import * as api from "@/lib/api";

/**
 * Localization settings panel (sec 47).
 *
 * Two layers:
 *
 *   1. Tenant content locale — drives which translation a public-site
 *      visitor sees by default. Stored on the Tenant row and read by
 *      the public CMS endpoints.
 *
 *   2. UI language — purely client-side. Picks which translation file
 *      from `lib/i18n.ts` the designer renders strings in. Lives in
 *      localStorage; persists across sessions.
 *
 * The two are intentionally decoupled. A studio publishing in
 * Japanese might still have admins who prefer the English UI; the
 * inverse is also common (English-language games run by a French
 * studio).
 *
 * IETF BCP 47 tags are the canonical form. We accept short forms
 * (`en`, `de`, `pt-BR`); the API normalizes for matching.
 */

const COMMON_LOCALES: Array<{ tag: string; label: string }> = [
  { tag: "en", label: "English" },
  { tag: "es", label: "Español" },
  { tag: "fr", label: "Français" },
  { tag: "de", label: "Deutsch" },
  { tag: "it", label: "Italiano" },
  { tag: "pt-BR", label: "Português (Brasil)" },
  { tag: "pt-PT", label: "Português (Portugal)" },
  { tag: "ja", label: "日本語" },
  { tag: "ko", label: "한국어" },
  { tag: "zh-CN", label: "中文 (简体)" },
  { tag: "zh-TW", label: "中文 (繁體)" },
  { tag: "ru", label: "Русский" },
  { tag: "ar", label: "العربية" },
  { tag: "hi", label: "हिन्दी" },
];

function labelFor(tag: string): string {
  return COMMON_LOCALES.find((l) => l.tag.toLowerCase() === tag.toLowerCase())?.label
    ?? tag;
}

export function LocalizationSection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const refreshTenants = useDesigner((s) => s.loadInitial);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;

  const [uiLocale, setUiLocale] = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tenant content locale state. We initialise from the active tenant
  // and reset whenever the tenant flips.
  const supportedFromTenant =
    (tenant?.supportedLocalesJson as string[] | undefined) ?? ["en"];
  const [defaultLocale, setDefaultLocale] = useState(
    tenant?.defaultLocale ?? "en",
  );
  const [supported, setSupported] = useState<string[]>(supportedFromTenant);
  const [adding, setAdding] = useState("");

  if (!tenant) return null;

  function toggleSupported(tag: string) {
    if (tag === defaultLocale) return; // can't drop the default
    setSupported((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function addCustom() {
    const norm = adding.trim();
    if (!norm) return;
    if (supported.includes(norm)) return;
    setSupported([...supported, norm]);
    setAdding("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Default must always appear in supported. Force-include it.
      const safe = supported.includes(defaultLocale)
        ? supported
        : [defaultLocale, ...supported];
      await api.updateTenant(tenant.id, {
        defaultLocale,
        supportedLocalesJson: safe,
      } as Parameters<typeof api.updateTenant>[1]);
      await refreshTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3">
        <h3 className="text-sm font-medium text-ink-100">Localization</h3>
        <p className="text-[11px] text-ink-500">
          Visitors see the default unless their <code className="font-mono">?lang=</code>
          {" "}query or browser preference matches a supported language.
        </p>
      </header>

      {/* Tenant default + supported */}
      <div className="space-y-3">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400">
            Default content language
          </span>
          <select
            value={defaultLocale}
            onChange={(e) => {
              setDefaultLocale(e.target.value);
              if (!supported.includes(e.target.value)) {
                setSupported([...supported, e.target.value]);
              }
            }}
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          >
            {[...new Set([...COMMON_LOCALES.map((l) => l.tag), ...supported])].map(
              (tag) => (
                <option key={tag} value={tag}>
                  {labelFor(tag)} ({tag})
                </option>
              ),
            )}
          </select>
        </label>

        <fieldset>
          <legend className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
            Languages this tenant publishes in
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_LOCALES.map((l) => {
              const active = supported.includes(l.tag);
              const isDefault = l.tag === defaultLocale;
              return (
                <button
                  key={l.tag}
                  type="button"
                  onClick={() => toggleSupported(l.tag)}
                  disabled={isDefault}
                  className={[
                    "rounded border px-2 py-0.5 text-[10px]",
                    active
                      ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                      : "border-ink-700 bg-ink-800 text-ink-300 hover:bg-ink-700",
                    isDefault ? "ring-1 ring-accent-500/40" : "",
                  ].join(" ")}
                  title={isDefault ? "Default language can't be removed" : ""}
                >
                  {l.label}
                  {isDefault && " (default)"}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="Custom IETF tag (e.g. nb-NO)"
              className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={!adding.trim()}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {supported.filter((s) => !COMMON_LOCALES.some((l) => l.tag === s)).length >
            0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {supported
                .filter((s) => !COMMON_LOCALES.some((l) => l.tag === s))
                .map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded border border-accent-500/60 bg-accent-500/15 px-2 py-0.5 text-[10px] text-accent-300"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => toggleSupported(tag)}
                      className="hover:text-danger-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          )}
        </fieldset>

        {error && (
          <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save tenant locales"}
        </button>
      </div>

      {/* UI language — separate from tenant content */}
      <div className="mt-6 rounded border border-ink-800 bg-ink-950 p-3">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
          Designer UI language
        </p>
        <p className="mb-2 text-[11px] text-ink-500">
          Just for you — won't change what visitors see on the public site.
        </p>
        <select
          value={uiLocale}
          onChange={(e) => setUiLocale(e.target.value)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
        >
          {availableLocales().map((tag) => (
            <option key={tag} value={tag}>
              {labelFor(tag)}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
