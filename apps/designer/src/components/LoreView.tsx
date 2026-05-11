import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Lore, LoreKind } from "@/lib/apiTypes";
import { assetBlobUrl } from "@/lib/api";

const LORE_KINDS: { value: LoreKind; label: string }[] = [
  { value: "world", label: "Worlds" },
  { value: "region", label: "Regions" },
  { value: "character", label: "Characters" },
  { value: "artifact", label: "Artifacts" },
  { value: "event", label: "Events" },
  { value: "timeline", label: "Timeline" },
  { value: "chapter", label: "Story chapters" },
  { value: "custom", label: "Other" },
];

/**
 * Lore view (sec 29).
 *
 * Project-scoped worldbuilding records — characters, regions, events,
 * artifacts, story chapters. Layout mirrors the FactionsView pattern:
 *   • Left aside  — kind tabs + entry list within the active kind.
 *   • Right main — detail panel with name / summary / body (markdown) /
 *                  cover asset id / faction / set / status.
 *
 * Visibility (sec 14.12) controls whether an entry surfaces on the
 * public lore portal. Authors stage drafts privately, then flip to
 * `public` when the story moment is canon.
 */
export function LoreView() {
  const project = useDesigner(selectActiveProject);
  const [entries, setEntries] = useState<Lore[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<LoreKind>("character");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.listLore({ projectId: project.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () => entries.filter((e) => e.kind === activeKind),
    [entries, activeKind],
  );
  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  // Tab counts come from the unfiltered list — gives the user a quick
  // sense of what they have without flipping through tabs.
  const counts = useMemo(() => {
    const m = new Map<LoreKind, number>();
    for (const e of entries) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [entries]);

  async function handleCreate(input: {
    name: string;
    slug: string;
    kind: LoreKind;
    summary: string;
  }) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createLore({ projectId: project.id, ...input });
      setEntries((prev) => [...prev, created]);
      setActiveKind(created.kind);
      setSelectedId(created.id);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePatch(id: string, patch: Partial<Lore>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateLore(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this lore entry? Card references survive.")) return;
    try {
      await api.deleteLore(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to manage its lore.</p>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[300px_1fr] overflow-hidden">
      <aside className="flex flex-col overflow-hidden border-r border-ink-700 bg-ink-900">
        <header className="border-b border-ink-700 px-3 py-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Project: {project.name}
          </p>
          <h1 className="mt-1 text-base font-semibold text-ink-50">Lore</h1>
          <p className="mt-1 text-xs text-ink-400">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setCreating(true);
              }}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
            >
              + New entry
            </button>
          </div>
        </header>

        {/* Kind tabs */}
        <nav className="border-b border-ink-700 px-2 py-2">
          <ul className="flex flex-wrap gap-1">
            {LORE_KINDS.map((k) => {
              const n = counts.get(k.value) ?? 0;
              const active = activeKind === k.value;
              return (
                <li key={k.value}>
                  <button
                    type="button"
                    onClick={() => setActiveKind(k.value)}
                    className={[
                      "rounded border px-2 py-0.5 text-[11px]",
                      active
                        ? "border-accent-500/40 bg-accent-500/15 text-accent-200"
                        : "border-ink-800 bg-ink-900 text-ink-300 hover:bg-ink-800",
                    ].join(" ")}
                  >
                    {k.label}
                    <span className="ml-1 font-mono text-[10px] text-ink-500">{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <ul className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <li className="px-3 py-4 text-center text-xs text-ink-500">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-500">
              No {LORE_KINDS.find((k) => k.value === activeKind)?.label.toLowerCase() ?? ""} yet.
            </li>
          ) : (
            filtered.map((e) => (
              <li
                key={e.id}
                onClick={() => {
                  setSelectedId(e.id);
                  setCreating(false);
                }}
                className={[
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                  selectedId === e.id
                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                    : "text-ink-100 hover:bg-ink-800",
                ].join(" ")}
              >
                {e.coverAssetId ? (
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-800">
                    <img
                      src={assetBlobUrl(e.coverAssetId)}
                      alt=""
                      className="max-h-full max-w-full object-cover"
                    />
                  </span>
                ) : (
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-ink-800 text-[10px] text-ink-500">
                    {e.kind[0]?.toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-500">
                    {e.slug}
                  </span>
                </span>
                <VisibilityPill v={e.visibility} />
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="overflow-y-auto bg-ink-950 p-6">
        {error && (
          <div className="mb-4 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}
        {creating ? (
          <LoreCreateForm
            defaultKind={activeKind}
            onCancel={() => setCreating(false)}
            onCreate={handleCreate}
            busy={busy}
          />
        ) : selected ? (
          <LoreDetail
            entry={selected}
            onPatch={(patch) => handlePatch(selected.id, patch)}
            onDelete={() => handleDelete(selected.id)}
            busy={busy}
          />
        ) : (
          <div className="rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500">
            Pick an entry on the left, or click <span className="text-ink-300">New entry</span>.
          </div>
        )}
      </main>
    </div>
  );
}

function VisibilityPill({ v }: { v: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    private: { label: "Private", cls: "bg-ink-800 text-ink-400" },
    internal: { label: "Internal", cls: "bg-ink-800 text-ink-300" },
    public_after_release: { label: "After release", cls: "bg-amber-500/15 text-amber-300" },
    public: { label: "Public", cls: "bg-emerald-500/15 text-emerald-300" },
  };
  const m = map[v] ?? map.private;
  return (
    <span
      className={[
        "shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
        m.cls,
      ].join(" ")}
    >
      {m.label}
    </span>
  );
}

function LoreCreateForm({
  defaultKind,
  onCancel,
  onCreate,
  busy,
}: {
  defaultKind: LoreKind;
  onCancel: () => void;
  onCreate: (input: { name: string; slug: string; kind: LoreKind; summary: string }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<LoreKind>(defaultKind);
  const [summary, setSummary] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);

  function onName(v: string) {
    setName(v);
    if (!touchedSlug) setSlug(slugify(v));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !slug) return;
    onCreate({ name, slug, kind, summary });
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <header>
        <h2 className="text-base font-semibold text-ink-50">New lore entry</h2>
        <p className="mt-1 text-xs text-ink-400">
          Pick a kind, name, and slug. Body, cover art, faction, and visibility can be
          added afterward.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LoreKind)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {LORE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={onName} />
        </Field>
      </div>
      <Field label="Slug" hint="URL-safe identifier; unique inside the project.">
        <Input
          value={slug}
          onChange={(v) => {
            setTouchedSlug(true);
            setSlug(v);
          }}
        />
      </Field>
      <Field label="Summary" hint="Short blurb for tile previews.">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
        />
      </Field>
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name || !slug}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function LoreDetail({
  entry,
  onPatch,
  onDelete,
  busy,
}: {
  entry: Lore;
  onPatch: (patch: Partial<Lore>) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Lore>(entry);
  useEffect(() => setDraft(entry), [entry]);

  function commit<K extends keyof Lore>(key: K, value: Lore[K]) {
    if (entry[key] === value) return;
    setDraft({ ...draft, [key]: value });
    onPatch({ [key]: value } as Partial<Lore>);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-500">{entry.kind}</p>
          <h2 className="mt-0.5 text-base font-semibold text-ink-50">{entry.name}</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-500">{entry.slug}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20 disabled:opacity-40"
        >
          Delete
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(v) => setDraft({ ...draft, name: v })}
            onBlur={() => commit("name", draft.name)}
          />
        </Field>
        <Field label="Kind">
          <select
            value={draft.kind}
            onChange={(e) => commit("kind", e.target.value as LoreKind)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {LORE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(e) => commit("status", e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["draft", "review", "approved", "released", "archived"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Visibility">
          <select
            value={draft.visibility}
            onChange={(e) => commit("visibility", e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["private", "internal", "public_after_release", "public"].map((v) => (
              <option key={v} value={v}>
                {v.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cover asset id" hint="Asset id from the project's library.">
          <Input
            value={draft.coverAssetId ?? ""}
            onChange={(v) => setDraft({ ...draft, coverAssetId: v.trim() || null })}
            onBlur={() => commit("coverAssetId", draft.coverAssetId)}
          />
        </Field>
        <Field label="Faction id" hint="Optional — links character → faction etc.">
          <Input
            value={draft.factionId ?? ""}
            onChange={(v) => setDraft({ ...draft, factionId: v.trim() || null })}
            onBlur={() => commit("factionId", draft.factionId)}
          />
        </Field>
        <Field label="Set id" hint="Optional — for set-canonical events.">
          <Input
            value={draft.setId ?? ""}
            onChange={(v) => setDraft({ ...draft, setId: v.trim() || null })}
            onBlur={() => commit("setId", draft.setId)}
          />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDraft({ ...draft, sortOrder: Number.isFinite(n) ? n : draft.sortOrder });
            }}
            onBlur={() => commit("sortOrder", draft.sortOrder)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
          />
        </Field>
      </div>

      <Field label="Summary" hint="Tile preview text — keep short.">
        <textarea
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          onBlur={() => commit("summary", draft.summary)}
          rows={2}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
        />
      </Field>
      <Field label="Body" hint="Markdown. Renders on the public lore page.">
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          onBlur={() => commit("body", draft.body)}
          rows={14}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs leading-relaxed text-ink-100"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
    />
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
