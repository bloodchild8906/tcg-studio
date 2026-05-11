import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Faction } from "@/lib/apiTypes";
import { assetBlobUrl } from "@/lib/api";

/**
 * Standalone Factions view (sec 28).
 *
 * Project-wide list of factions — identity (name + color), visuals
 * (icon + frame asset), and lore. The table is the same shape as the
 * keyword glossary view: list left, edit form right, modal-free flow.
 *
 * Cards reference factions via free-form `dataJson.faction` (mono) or
 * `dataJson.factions` (multi). Variant rules in the card type designer
 * already pick those up — defining a faction here makes the picker
 * authoritative and gives the variant system a single source of truth
 * for color/frame mapping.
 */
export function FactionsView() {
  const project = useDesigner(selectActiveProject);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setFactions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setFactions(await api.listFactions({ projectId: project.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => factions.find((f) => f.id === selectedId) ?? null,
    [factions, selectedId],
  );

  async function handleCreate(input: {
    name: string;
    slug: string;
    color: string;
  }) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createFaction({
        projectId: project.id,
        ...input,
      });
      setFactions((prev) => [...prev, created]);
      setSelectedId(created.id);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePatch(id: string, patch: Partial<Faction>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateFaction(id, patch);
      setFactions((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this faction? Cards referencing its slug keep their value.")) return;
    try {
      await api.deleteFaction(id);
      setFactions((prev) => prev.filter((f) => f.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to manage its factions.</p>
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
          <h1 className="mt-1 text-base font-semibold text-ink-50">Factions</h1>
          <p className="mt-1 text-xs text-ink-400">
            {factions.length} faction{factions.length === 1 ? "" : "s"}
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
              + New faction
            </button>
          </div>
        </header>
        <ul className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <li className="px-3 py-4 text-center text-xs text-ink-500">Loading…</li>
          ) : factions.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-500">
              No factions yet.
            </li>
          ) : (
            factions.map((f) => (
              <li
                key={f.id}
                onClick={() => {
                  setSelectedId(f.id);
                  setCreating(false);
                }}
                className={[
                  "group flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                  selectedId === f.id
                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                    : "text-ink-100 hover:bg-ink-800",
                ].join(" ")}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded"
                  style={{ background: f.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-500">
                    {f.slug}
                  </span>
                </span>
                {f.iconAssetId && (
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-800">
                    <img
                      src={assetBlobUrl(f.iconAssetId)}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  </span>
                )}
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
          <FactionCreateForm onCancel={() => setCreating(false)} onCreate={handleCreate} busy={busy} />
        ) : selected ? (
          <FactionDetail
            faction={selected}
            onPatch={(patch) => handlePatch(selected.id, patch)}
            onDelete={() => handleDelete(selected.id)}
            busy={busy}
          />
        ) : (
          <div className="rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500">
            Pick a faction on the left, or click <span className="text-ink-300">New faction</span> to add one.
          </div>
        )}
      </main>
    </div>
  );
}

function FactionCreateForm({
  onCreate,
  onCancel,
  busy,
}: {
  onCreate: (input: { name: string; slug: string; color: string }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState("#b34a40");
  const [touchedSlug, setTouchedSlug] = useState(false);

  // Auto-derive slug from name unless the user has already touched it —
  // keeps the form fast for the common case (Fire → fire, Crimson Pact →
  // crimson-pact) without locking out manual overrides.
  function onName(v: string) {
    setName(v);
    if (!touchedSlug) setSlug(slugify(v));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !slug) return;
    onCreate({ name, slug, color });
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <header>
        <h2 className="text-base font-semibold text-ink-50">New faction</h2>
        <p className="mt-1 text-xs text-ink-400">
          Identity, color, and slug. Icon / frame / lore can be filled in afterwards.
        </p>
      </header>
      <Field label="Name">
        <Input value={name} onChange={onName} />
      </Field>
      <Field label="Slug" hint="Used in card data and URLs.">
        <Input
          value={slug}
          onChange={(v) => {
            setTouchedSlug(true);
            setSlug(v);
          }}
        />
      </Field>
      <Field label="Color" hint="Hex; used by variant rules and badges.">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
          />
          <Input value={color} onChange={setColor} />
        </div>
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

function FactionDetail({
  faction,
  onPatch,
  onDelete,
  busy,
}: {
  faction: Faction;
  onPatch: (patch: Partial<Faction>) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  // Local mirror so the user sees their typing instantly. We commit on
  // blur (text fields) or on change (color picker / select).
  const [draft, setDraft] = useState<Faction>(faction);
  useEffect(() => setDraft(faction), [faction]);

  function commitField<K extends keyof Faction>(key: K, value: Faction[K]) {
    if (faction[key] === value) return;
    setDraft({ ...draft, [key]: value });
    onPatch({ [key]: value } as Partial<Faction>);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink-50">{faction.name}</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-500">{faction.slug}</p>
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
            onBlur={() => commitField("name", draft.name)}
          />
        </Field>
        <Field label="Status">
          <Select
            value={draft.status}
            options={["draft", "approved", "deprecated"]}
            onChange={(v) => commitField("status", v)}
          />
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft.color}
              onChange={(e) => commitField("color", e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
            />
            <Input
              value={draft.color}
              onChange={(v) => setDraft({ ...draft, color: v })}
              onBlur={() => commitField("color", draft.color)}
            />
          </div>
        </Field>
        <Field label="Sort order" hint="Lower appears earlier in pickers.">
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDraft({ ...draft, sortOrder: Number.isFinite(n) ? n : draft.sortOrder });
            }}
            onBlur={() => commitField("sortOrder", draft.sortOrder)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          onBlur={() => commitField("description", draft.description)}
          rows={2}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        />
      </Field>

      <Field label="Icon asset id" hint="Small icon — cost slots, badges, picker tiles.">
        <Input
          value={draft.iconAssetId ?? ""}
          onChange={(v) => setDraft({ ...draft, iconAssetId: v.trim() || null })}
          onBlur={() => commitField("iconAssetId", draft.iconAssetId)}
        />
      </Field>
      <Field
        label="Banner / portrait asset id"
        hint="Large-format art — lore pages, public faction profile, picker header, decklist hero."
      >
        <Input
          value={draft.imageAssetId ?? ""}
          onChange={(v) => setDraft({ ...draft, imageAssetId: v.trim() || null })}
          onBlur={() => commitField("imageAssetId", draft.imageAssetId)}
        />
        {draft.imageAssetId && (
          <img
            src={assetBlobUrl(draft.imageAssetId)}
            alt=""
            className="mt-2 max-h-40 w-full rounded border border-ink-700 object-cover"
            onError={(e) => {
              // Hide broken-image placeholder if the id is invalid — the
              // text field still shows what was typed so the user can fix it.
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </Field>
      <Field label="Frame art asset id" hint="Default frame asset for variant rules.">
        <Input
          value={draft.frameAssetId ?? ""}
          onChange={(v) => setDraft({ ...draft, frameAssetId: v.trim() || null })}
          onBlur={() => commitField("frameAssetId", draft.frameAssetId)}
        />
      </Field>

      <Field
        label="Mechanics"
        hint="Comma-separated keyword slugs / mechanic names associated with this faction."
      >
        <Input
          value={draft.mechanicsJson.join(", ")}
          onChange={(v) =>
            setDraft({
              ...draft,
              mechanicsJson: v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          onBlur={() => commitField("mechanicsJson", draft.mechanicsJson)}
        />
      </Field>

      <Field label="Lore">
        <textarea
          value={draft.lore}
          onChange={(e) => setDraft({ ...draft, lore: e.target.value })}
          onBlur={() => commitField("lore", draft.lore)}
          rows={6}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
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
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Lightweight slugify — lowercases, strips non-[a-z0-9-], collapses dashes. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
