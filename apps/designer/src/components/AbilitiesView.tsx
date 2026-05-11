import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Ability, AbilityKind, Keyword } from "@/lib/apiTypes";

const ABILITY_KINDS: { value: AbilityKind; label: string; hint: string }[] = [
  { value: "static", label: "Static", hint: "Always-on effect (e.g. \"+1/+1 while you control a Forest\")." },
  { value: "triggered", label: "Triggered", hint: "Fires when something happens (\"When this enters…\")." },
  { value: "activated", label: "Activated", hint: "Player pays a cost to use (\"{T}: Draw a card\")." },
  { value: "replacement", label: "Replacement", hint: "Modifies another event before it resolves." },
  { value: "prevention", label: "Prevention", hint: "Cancels an event ('Prevent the next 3 damage…')." },
  { value: "resource", label: "Resource", hint: "Generates a player-resource (mana / energy / focus)." },
  { value: "combat", label: "Combat", hint: "Applies during combat (first strike, lifelink, …)." },
];

/**
 * Abilities view (sec 24).
 *
 * Project-scoped catalog of reusable rules-text fragments. Cards
 * reference abilities by id from `dataJson.abilities` — adding,
 * removing, or errata-ing an ability cascades to every card that uses
 * it without a card-by-card rewrite.
 *
 * Layout mirrors LoreView and FactionsView:
 *   • Left  — kind tabs + entry list within the active kind.
 *   • Right — detail editor (name / kind / text / trigger / cost / keyword
 *             link / reminder / status / graph placeholder).
 *
 * The visual graph editor (sec 24.2) lives in `graphJson` — for MVP we
 * just expose the JSON as a textarea so a power user can prototype an
 * ability graph before the node UI ships.
 */
export function AbilitiesView() {
  const project = useDesigner(selectActiveProject);
  const [entries, setEntries] = useState<Ability[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<AbilityKind>("triggered");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setEntries([]);
      setKeywords([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [a, k] = await Promise.all([
        api.listAbilities({ projectId: project.id }),
        api.listKeywords({ projectId: project.id }).catch(() => []),
      ]);
      setEntries(a);
      setKeywords(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => entries.filter((e) => e.kind === activeKind), [entries, activeKind]);
  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const counts = useMemo(() => {
    const m = new Map<AbilityKind, number>();
    for (const e of entries) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [entries]);

  async function handleCreate(input: {
    name: string;
    slug: string;
    kind: AbilityKind;
    text: string;
  }) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createAbility({ projectId: project.id, ...input });
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

  async function handlePatch(id: string, patch: Partial<Ability>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateAbility(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this ability? Cards keep references but display nothing for it.")) return;
    try {
      await api.deleteAbility(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to manage its abilities.</p>
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
          <h1 className="mt-1 text-base font-semibold text-ink-50">Abilities</h1>
          <p className="mt-1 text-xs text-ink-400">
            {entries.length} ability{entries.length === 1 ? "" : "es"} · catalog of rules-text fragments
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
              + New ability
            </button>
          </div>
        </header>

        {/* Kind tabs */}
        <nav className="border-b border-ink-700 px-2 py-2">
          <ul className="flex flex-wrap gap-1">
            {ABILITY_KINDS.map((k) => {
              const n = counts.get(k.value) ?? 0;
              const active = activeKind === k.value;
              return (
                <li key={k.value}>
                  <button
                    type="button"
                    onClick={() => setActiveKind(k.value)}
                    title={k.hint}
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
              No {ABILITY_KINDS.find((k) => k.value === activeKind)?.label.toLowerCase()} abilities yet.
            </li>
          ) : (
            filtered.map((a) => (
              <li
                key={a.id}
                onClick={() => {
                  setSelectedId(a.id);
                  setCreating(false);
                }}
                className={[
                  "flex cursor-pointer items-start gap-2 px-3 py-2 text-xs",
                  selectedId === a.id
                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                    : "text-ink-100 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-500">{a.slug}</span>
                  {a.text && (
                    <span className="mt-0.5 line-clamp-2 block text-[10px] text-ink-400">
                      {a.text}
                    </span>
                  )}
                </span>
                <StatusPill status={a.status} />
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
          <AbilityCreateForm
            defaultKind={activeKind}
            onCancel={() => setCreating(false)}
            onCreate={handleCreate}
            busy={busy}
          />
        ) : selected ? (
          <AbilityDetail
            ability={selected}
            keywords={keywords}
            onPatch={(patch) => handlePatch(selected.id, patch)}
            onDelete={() => handleDelete(selected.id)}
            busy={busy}
          />
        ) : (
          <div className="rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500">
            Pick an ability on the left, or click <span className="text-ink-300">New ability</span>.
          </div>
        )}
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-ink-800 text-ink-400" },
    review: { label: "Review", cls: "bg-amber-500/15 text-amber-300" },
    approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300" },
    deprecated: { label: "Deprecated", cls: "bg-danger-500/15 text-danger-500" },
  };
  const m = map[status] ?? map.draft;
  return (
    <span className={["shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider", m.cls].join(" ")}>
      {m.label}
    </span>
  );
}

function AbilityCreateForm({
  defaultKind,
  onCancel,
  onCreate,
  busy,
}: {
  defaultKind: AbilityKind;
  onCancel: () => void;
  onCreate: (input: { name: string; slug: string; kind: AbilityKind; text: string }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<AbilityKind>(defaultKind);
  const [text, setText] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || !slug) return;
        onCreate({ name, slug, kind, text });
      }}
      className="max-w-xl space-y-4"
    >
      <header>
        <h2 className="text-base font-semibold text-ink-50">New ability</h2>
        <p className="mt-1 text-xs text-ink-400">
          Pick a kind, give it a slug, write the rules text. Trigger / cost / graph live on the
          detail editor afterward.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AbilityKind)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {ABILITY_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <Input
            value={name}
            onChange={(v) => {
              setName(v);
              if (!touchedSlug) setSlug(slugify(v));
            }}
          />
        </Field>
      </div>
      <Field label="Slug" hint="URL-safe identifier, unique inside the project.">
        <Input
          value={slug}
          onChange={(v) => {
            setTouchedSlug(true);
            setSlug(v);
          }}
        />
      </Field>
      <Field label="Rules text" hint="What appears on the printed card.">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="When this enters the battlefield, draw a card."
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

function AbilityDetail({
  ability,
  keywords,
  onPatch,
  onDelete,
  busy,
}: {
  ability: Ability;
  keywords: Keyword[];
  onPatch: (patch: Partial<Ability>) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Ability>(ability);
  useEffect(() => setDraft(ability), [ability]);

  function commit<K extends keyof Ability>(key: K, value: Ability[K]) {
    if (ability[key] === value) return;
    setDraft({ ...draft, [key]: value });
    onPatch({ [key]: value } as Partial<Ability>);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-500">{ability.kind}</p>
          <h2 className="mt-0.5 text-base font-semibold text-ink-50">{ability.name}</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-500">{ability.slug}</p>
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
            onChange={(e) => commit("kind", e.target.value as AbilityKind)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {ABILITY_KINDS.map((k) => (
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
            {["draft", "review", "approved", "deprecated"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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

      <Field
        label="Rules text"
        hint="Printed on the card. References to other abilities by name resolve at render time."
      >
        <textarea
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onBlur={() => commit("text", draft.text)}
          rows={3}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
        />
      </Field>

      <Field label="Reminder text" hint="Italic flavor / clarification under the rules text.">
        <textarea
          value={draft.reminderText}
          onChange={(e) => setDraft({ ...draft, reminderText: e.target.value })}
          onBlur={() => commit("reminderText", draft.reminderText)}
          rows={2}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs italic text-ink-300"
        />
      </Field>

      {(draft.kind === "triggered" ||
        draft.kind === "activated" ||
        draft.kind === "replacement" ||
        draft.kind === "prevention") && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trigger" hint='Condition phrase, e.g. "enters battlefield".'>
            <Input
              value={draft.trigger}
              onChange={(v) => setDraft({ ...draft, trigger: v })}
              onBlur={() => commit("trigger", draft.trigger)}
            />
          </Field>
          <Field label="Cost" hint='Activation cost, e.g. "{T}", "Pay 2 life".'>
            <Input
              value={draft.cost}
              onChange={(v) => setDraft({ ...draft, cost: v })}
              onBlur={() => commit("cost", draft.cost)}
            />
          </Field>
        </div>
      )}

      <Field label="Linked keyword" hint="Optional — keyword-granted abilities point back to the glossary.">
        <select
          value={draft.keywordId ?? ""}
          onChange={(e) => commit("keywordId", e.target.value || null)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        >
          <option value="">— None —</option>
          {keywords.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name} · {k.slug}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Ability graph (JSON)"
        hint="Reserved for the visual graph editor (sec 24.2). Empty for now; power users can paste node-graph data here."
      >
        <textarea
          value={JSON.stringify(draft.graphJson, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              setDraft({ ...draft, graphJson: parsed });
            } catch {
              // ignore mid-typing — wait for valid JSON before committing
            }
          }}
          onBlur={() => commit("graphJson", draft.graphJson)}
          rows={4}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-100"
        />
      </Field>

      <div className="rounded border border-ink-800 bg-ink-900/40 p-3">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400">Preview</h3>
        <CardAbilityPreview ability={draft} />
      </div>
    </div>
  );
}

/**
 * Mini renderer that previews how this ability will appear on a card —
 * trigger / cost prefix where relevant, then the rules text + italic
 * reminder. Saves authors a trip to the card editor to see the result.
 */
function CardAbilityPreview({ ability }: { ability: Ability }) {
  const showHeader = ability.cost || ability.trigger;
  return (
    <div className="mt-2 rounded border border-ink-700 bg-[#262c3d] p-3 text-[12px] leading-snug text-ink-50">
      {showHeader && (
        <p className="font-mono text-[11px] text-accent-300">
          {ability.cost && <>{ability.cost} </>}
          {ability.trigger && <>&mdash; {ability.trigger}</>}
        </p>
      )}
      <p className="mt-1 text-ink-100">{ability.text || <em className="text-ink-500">No text yet.</em>}</p>
      {ability.reminderText && (
        <p className="mt-1 italic text-ink-400">{ability.reminderText}</p>
      )}
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
