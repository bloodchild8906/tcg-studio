import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Ruleset } from "@/lib/apiTypes";
import {
  RULESET_PRESETS,
  type RulesetConfig,
  type PhaseDef,
  type ScriptedAction,
  type WinCondition,
  type PlayerActionDef,
  type CardActionDef,
  DEFAULT_RULESET_CONFIG,
} from "@/lib/playtestEngine";

/**
 * Rulesets view (sec 23).
 *
 * Defines how the playtest engine runs a project's games — phase order,
 * player count, starting resources, win conditions, custom actions.
 *
 * Layout:
 *   • Left  — list of project rulesets, "+ New" button, "Clone preset"
 *             menu so authors can start from a sensible default rather
 *             than a blank slate.
 *   • Right — full ruleset editor: identity, player setup, phase list,
 *             win conditions, custom + card actions. Saves are
 *             commit-on-blur for header fields and explicit "Save" for
 *             nested config (so the user can iterate freely).
 */
export function RulesetsView() {
  const project = useDesigner(selectActiveProject);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setRulesets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRulesets(await api.listRulesets({ projectId: project.id }));
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
    () => rulesets.find((r) => r.id === selectedId) ?? null,
    [rulesets, selectedId],
  );

  async function handleCreate(input: {
    name: string;
    slug: string;
    config: RulesetConfig;
  }) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRuleset({
        projectId: project.id,
        name: input.name,
        slug: input.slug,
        configJson: input.config,
        isDefault: rulesets.length === 0, // first ruleset becomes default
      });
      setRulesets((prev) => [...prev, created]);
      setSelectedId(created.id);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePatch(id: string, patch: Partial<Ruleset>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateRuleset(id, patch);
      setRulesets((prev) =>
        prev.map((r) =>
          r.id === id
            ? updated
            : updated.isDefault
            ? { ...r, isDefault: false } // server already cleared others; mirror locally
            : r,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this ruleset? Active playtest sessions are unaffected.")) return;
    try {
      await api.deleteRuleset(id);
      setRulesets((prev) => prev.filter((r) => r.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to manage its rulesets.</p>
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
          <h1 className="mt-1 text-base font-semibold text-ink-50">Rulesets</h1>
          <p className="mt-1 text-xs text-ink-400">
            {rulesets.length} ruleset{rulesets.length === 1 ? "" : "s"} · turn structure + win conditions
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setCreating(true);
              }}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
            >
              + New
            </button>
            <PresetMenu
              onPick={(presetKey) => {
                const preset = RULESET_PRESETS[presetKey];
                if (!preset) return;
                setCreating(false);
                if (!project) return;
                void handleCreate({
                  name: preset.name,
                  slug: presetKey,
                  config: preset.config,
                });
              }}
            />
          </div>
        </header>
        <ul className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <li className="px-3 py-4 text-center text-xs text-ink-500">Loading…</li>
          ) : rulesets.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-500">
              No rulesets yet — start from a preset or create from scratch.
            </li>
          ) : (
            rulesets.map((r) => (
              <li
                key={r.id}
                onClick={() => {
                  setSelectedId(r.id);
                  setCreating(false);
                }}
                className={[
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                  selectedId === r.id
                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                    : "text-ink-100 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-500">
                    {r.slug}
                  </span>
                </span>
                {r.isDefault && (
                  <span className="rounded bg-accent-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-accent-300">
                    default
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
          <RulesetCreateForm onCreate={handleCreate} onCancel={() => setCreating(false)} busy={busy} />
        ) : selected ? (
          <RulesetEditor
            ruleset={selected}
            onSave={(p) => handlePatch(selected.id, p)}
            onDelete={() => handleDelete(selected.id)}
            busy={busy}
          />
        ) : (
          <div className="rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500">
            Pick a ruleset on the left, or click <span className="text-ink-300">+ New</span> /
            clone a preset to start.
          </div>
        )}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Preset menu                                                            */
/* ---------------------------------------------------------------------- */

function PresetMenu({ onPick }: { onPick: (key: string) => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 [&::-webkit-details-marker]:hidden">
        Clone preset
      </summary>
      <div className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded border border-ink-700 bg-ink-800 shadow-lg">
        {Object.entries(RULESET_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={(e) => {
              const details = e.currentTarget.closest("details") as HTMLDetailsElement | null;
              if (details) details.open = false;
              onPick(key);
            }}
            className="block w-full border-b border-ink-700 px-3 py-2 text-left last:border-0 hover:bg-ink-700"
          >
            <span className="block text-xs font-medium text-ink-100">{preset.name}</span>
            <span className="mt-0.5 block text-[10px] text-ink-400">{preset.description}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------------- */
/* Create form                                                            */
/* ---------------------------------------------------------------------- */

function RulesetCreateForm({
  onCreate,
  onCancel,
  busy,
}: {
  onCreate: (input: { name: string; slug: string; config: RulesetConfig }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || !slug) return;
        onCreate({ name, slug, config: DEFAULT_RULESET_CONFIG });
      }}
      className="max-w-md space-y-4"
    >
      <header>
        <h2 className="text-base font-semibold text-ink-50">New ruleset</h2>
        <p className="mt-1 text-xs text-ink-400">
          Empty ruleset — starts from the duel-style 1v1 default. Edit phases and player setup
          afterward.
        </p>
      </header>
      <Field label="Name">
        <Input
          value={name}
          onChange={(v) => {
            setName(v);
            if (!touchedSlug) setSlug(slugify(v));
          }}
        />
      </Field>
      <Field label="Slug">
        <Input
          value={slug}
          onChange={(v) => {
            setTouchedSlug(true);
            setSlug(v.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
          }}
        />
      </Field>
      <div className="flex gap-2">
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

/* ---------------------------------------------------------------------- */
/* Editor                                                                  */
/* ---------------------------------------------------------------------- */

function RulesetEditor({
  ruleset,
  onSave,
  onDelete,
  busy,
}: {
  ruleset: Ruleset;
  onSave: (patch: Partial<Ruleset>) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  // Local draft of the config JSON. The full config is the source of
  // truth — edits go through immutable replacement to keep the engine
  // happy.
  const [config, setConfig] = useState<RulesetConfig>(
    () => coerceConfig(ruleset.configJson),
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setConfig(coerceConfig(ruleset.configJson));
    setDirty(false);
  }, [ruleset.id, ruleset.configJson]);

  const updateConfig = (patch: Partial<RulesetConfig>) => {
    setConfig({ ...config, ...patch });
    setDirty(true);
  };

  const updatePlayerSetup = (patch: Partial<RulesetConfig["playerSetup"]>) => {
    setConfig({ ...config, playerSetup: { ...config.playerSetup, ...patch } });
    setDirty(true);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-50">{ruleset.name}</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-500">{ruleset.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-100">
            <input
              type="checkbox"
              checked={ruleset.isDefault}
              onChange={(e) => onSave({ isDefault: e.target.checked })}
              className="h-3 w-3 cursor-pointer accent-accent-500"
            />
            <span>Default for project</span>
          </label>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </header>

      {/* Identity */}
      <Section title="Identity">
        <Field label="Name">
          <Input value={ruleset.name} onCommit={(v) => onSave({ name: v })} />
        </Field>
        <Field label="Description">
          <textarea
            value={ruleset.description}
            onBlur={(e) =>
              e.target.value !== ruleset.description && onSave({ description: e.target.value })
            }
            onChange={() => undefined}
            defaultValue={ruleset.description}
            rows={2}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
          />
        </Field>
      </Section>

      {/* Player setup */}
      <Section title="Player setup">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min players">
            <NumberInput
              value={config.playerSetup.minPlayers}
              onChange={(v) => updatePlayerSetup({ minPlayers: Math.max(1, v) })}
            />
          </Field>
          <Field label="Max players">
            <NumberInput
              value={config.playerSetup.maxPlayers}
              onChange={(v) => updatePlayerSetup({ maxPlayers: Math.max(1, v) })}
            />
          </Field>
          <Field label="Default players">
            <NumberInput
              value={config.playerSetup.defaultPlayers}
              onChange={(v) =>
                updatePlayerSetup({
                  defaultPlayers: Math.max(
                    config.playerSetup.minPlayers,
                    Math.min(config.playerSetup.maxPlayers, v),
                  ),
                })
              }
            />
          </Field>
        </div>
        <Field label="Seat labels" hint="Comma-separated. Empty entries are auto-named (P3, P4…).">
          <Input
            value={config.playerSetup.seatLabels.join(", ")}
            onChange={(v) =>
              updatePlayerSetup({
                seatLabels: v.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="Starting hand size">
          <NumberInput
            value={config.playerSetup.startingHandSize}
            onChange={(v) => updatePlayerSetup({ startingHandSize: Math.max(0, v) })}
          />
        </Field>
        <Field label="Turn order">
          <select
            value={config.playerSetup.turnOrder}
            onChange={(e) =>
              updatePlayerSetup({ turnOrder: e.target.value as RulesetConfig["playerSetup"]["turnOrder"] })
            }
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            <option value="clockwise">clockwise (P1 → P2 → …)</option>
            <option value="active_player_only">active player only (solo / co-op)</option>
            <option value="random">random first player</option>
          </select>
        </Field>
        <ResourceListEditor
          resources={config.playerSetup.startingResources}
          onChange={(r) => updatePlayerSetup({ startingResources: r })}
        />
      </Section>

      {/* Phases */}
      <Section title="Turn phases" subtitle={`${config.phases.length} phases`}>
        <PhaseListEditor
          phases={config.phases}
          onChange={(phases) => updateConfig({ phases })}
        />
      </Section>

      {/* Win conditions */}
      <Section title="Win conditions" subtitle={`${config.winConditions.length}`}>
        <WinConditionListEditor
          items={config.winConditions}
          onChange={(items) => updateConfig({ winConditions: items })}
        />
      </Section>

      {/* Custom player + card actions */}
      <Section title="Player actions" subtitle={`${config.customActions.length}`}>
        <PlayerActionListEditor
          items={config.customActions}
          onChange={(items) => updateConfig({ customActions: items })}
        />
      </Section>
      <Section title="Card actions" subtitle={`${config.cardActions.length}`}>
        <CardActionListEditor
          items={config.cardActions}
          onChange={(items) => updateConfig({ cardActions: items })}
        />
      </Section>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-ink-700 bg-ink-950/90 px-6 py-3 backdrop-blur">
        <span className="text-[11px] text-ink-500">
          {dirty ? "Unsaved changes" : "Up to date"}
        </span>
        <button
          type="button"
          onClick={() => {
            onSave({ configJson: config });
            setDirty(false);
          }}
          disabled={busy || !dirty}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save ruleset"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sub-editors                                                            */
/* ---------------------------------------------------------------------- */

function ResourceListEditor({
  resources,
  onChange,
}: {
  resources: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const entries = Object.entries(resources);
  return (
    <Field label="Starting resources" hint="Per-player counters: life, mana, energy, etc.">
      <ul className="space-y-1.5">
        {entries.map(([k, v]) => (
          <li key={k} className="grid grid-cols-[1fr_120px_28px] items-end gap-2">
            <Input
              value={k}
              onChange={(nk) => {
                if (nk === k) return;
                const next = { ...resources };
                delete next[k];
                next[nk] = v;
                onChange(next);
              }}
            />
            <NumberInput
              value={v}
              onChange={(nv) => onChange({ ...resources, [k]: nv })}
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...resources };
                delete next[k];
                onChange(next);
              }}
              className="h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          const baseKey = "resource";
          let key = baseKey;
          let n = 2;
          while (resources[key] !== undefined) key = `${baseKey}${n++}`;
          onChange({ ...resources, [key]: 0 });
        }}
        className="mt-2 rounded border border-ink-700 bg-ink-800 px-3 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
      >
        + Resource
      </button>
    </Field>
  );
}

function PhaseListEditor({
  phases,
  onChange,
}: {
  phases: PhaseDef[];
  onChange: (next: PhaseDef[]) => void;
}) {
  function patchPhase(idx: number, patch: Partial<PhaseDef>) {
    onChange(phases.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function move(idx: number, dir: -1 | 1) {
    const t = idx + dir;
    if (t < 0 || t >= phases.length) return;
    const next = [...phases];
    [next[idx], next[t]] = [next[t], next[idx]];
    onChange(next);
  }
  return (
    <div className="space-y-3">
      {phases.map((phase, idx) => (
        <div key={phase.id} className="space-y-2 rounded border border-ink-800 bg-ink-950/40 p-3">
          <div className="grid grid-cols-[40px_1fr_140px_28px_28px] items-end gap-2">
            <span className="font-mono text-[10px] text-ink-500">#{idx + 1}</span>
            <Field label="Name">
              <Input value={phase.name} onChange={(v) => patchPhase(idx, { name: v })} />
            </Field>
            <Field label="Id">
              <Input value={phase.id} onChange={(v) => patchPhase(idx, { id: v })} />
            </Field>
            <button
              type="button"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              className="h-7 rounded border border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800 disabled:opacity-30"
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(idx, 1)}
              disabled={idx === phases.length - 1}
              className="h-7 rounded border border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800 disabled:opacity-30"
              title="Move down"
            >
              ↓
            </button>
          </div>
          <Field label="Description">
            <Input
              value={phase.description ?? ""}
              onChange={(v) => patchPhase(idx, { description: v })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-100">
              <input
                type="checkbox"
                checked={phase.activePlayerOnly}
                onChange={(e) => patchPhase(idx, { activePlayerOnly: e.target.checked })}
                className="h-3 w-3 cursor-pointer accent-accent-500"
              />
              <span>Active player only</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-100">
              <input
                type="checkbox"
                checked={!!phase.endsTurn}
                onChange={(e) => patchPhase(idx, { endsTurn: e.target.checked })}
                className="h-3 w-3 cursor-pointer accent-accent-500"
              />
              <span>Ends the turn</span>
            </label>
          </div>
          <ScriptedActionListEditor
            label="Auto actions on phase start"
            items={phase.autoActions}
            onChange={(items) => patchPhase(idx, { autoActions: items })}
          />
          <button
            type="button"
            onClick={() => onChange(phases.filter((_, i) => i !== idx))}
            className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500 hover:bg-danger-500/20"
          >
            Remove phase
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...phases,
            {
              id: `phase-${Math.random().toString(36).slice(2, 6)}`,
              name: "New phase",
              activePlayerOnly: true,
              autoActions: [],
            },
          ])
        }
        className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-100 hover:bg-ink-700"
      >
        + Phase
      </button>
    </div>
  );
}

function ScriptedActionListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: ScriptedAction[];
  onChange: (next: ScriptedAction[]) => void;
}) {
  return (
    <Field label={label}>
      <ul className="space-y-1.5">
        {items.map((a, i) => (
          <li
            key={i}
            className="grid grid-cols-[140px_140px_1fr_28px] items-end gap-2 rounded border border-ink-800 bg-ink-950/60 p-2"
          >
            <select
              value={a.kind}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? { ...x, kind: e.target.value as ScriptedAction["kind"] } : x)))
              }
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
            >
              {[
                "draw_cards",
                "shuffle_zone",
                "set_resource",
                "increment_resource",
                "untap_zone",
                "tap_zone",
                "move_zone_contents",
                "reveal_top",
                "increment_card_counter",
                "custom",
              ].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={a.target ?? "active_player"}
              onChange={(e) =>
                onChange(items.map((x, j) => (j === i ? { ...x, target: e.target.value as ScriptedAction["target"] } : x)))
              }
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
            >
              {["active_player", "all_players", "each_opponent", "specific_seat"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Input
              value={JSON.stringify(a.params ?? {})}
              onChange={(v) => {
                try {
                  const parsed = JSON.parse(v);
                  onChange(items.map((x, j) => (j === i ? { ...x, params: parsed } : x)));
                } catch {
                  // Invalid JSON — ignore until the user finishes typing.
                }
              }}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...items, { kind: "draw_cards", target: "active_player", params: { count: 1 } }])}
        className="mt-2 rounded border border-ink-700 bg-ink-800 px-3 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
      >
        + Action
      </button>
    </Field>
  );
}

function WinConditionListEditor({
  items,
  onChange,
}: {
  items: WinCondition[];
  onChange: (next: WinCondition[]) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((wc, i) => (
        <li key={i} className="space-y-2 rounded border border-ink-800 bg-ink-950/40 p-3">
          <div className="grid grid-cols-[1fr_140px_28px] items-end gap-2">
            <Field label="Label">
              <Input value={wc.label} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
            </Field>
            <Field label="Outcome">
              <select
                value={wc.outcome}
                onChange={(e) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, outcome: e.target.value as WinCondition["outcome"] } : x)))
                }
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              >
                <option value="loss">loss</option>
                <option value="win">win</option>
              </select>
            </Field>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="mt-4 h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Kind">
              <select
                value={wc.kind}
                onChange={(e) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, kind: e.target.value as WinCondition["kind"] } : x)))
                }
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              >
                {["resource_threshold", "zone_empty", "zone_count", "phase_loss", "custom"].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Resource / zone">
              <Input
                value={wc.resource ?? wc.zoneKind ?? ""}
                onChange={(v) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? wc.kind === "resource_threshold"
                          ? { ...x, resource: v }
                          : { ...x, zoneKind: v }
                        : x,
                    ),
                  )
                }
              />
            </Field>
            <div className="grid grid-cols-[1fr_70px] items-end gap-2">
              <Field label="Comparator">
                <select
                  value={wc.comparator ?? "<="}
                  onChange={(e) =>
                    onChange(items.map((x, j) => (j === i ? { ...x, comparator: e.target.value as WinCondition["comparator"] } : x)))
                  }
                  className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                >
                  {["<=", ">=", "=="].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Value">
                <NumberInput
                  value={wc.threshold ?? 0}
                  onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, threshold: v } : x)))}
                />
              </Field>
            </div>
          </div>
        </li>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...items,
            { label: "Reduced to 0 life", kind: "resource_threshold", resource: "life", threshold: 0, comparator: "<=", outcome: "loss" },
          ])
        }
        className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-100 hover:bg-ink-700"
      >
        + Win condition
      </button>
    </ul>
  );
}

function PlayerActionListEditor({
  items,
  onChange,
}: {
  items: PlayerActionDef[];
  onChange: (next: PlayerActionDef[]) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((a, i) => (
        <li key={a.id} className="space-y-2 rounded border border-ink-800 bg-ink-950/40 p-3">
          <div className="grid grid-cols-[140px_1fr_70px_28px] items-end gap-2">
            <Field label="Id">
              <Input value={a.id} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, id: v } : x)))} />
            </Field>
            <Field label="Label">
              <Input value={a.label} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
            </Field>
            <Field label="Hotkey">
              <Input
                value={a.hotkey ?? ""}
                onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, hotkey: v || undefined } : x)))}
              />
            </Field>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="mt-4 h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
            >
              ×
            </button>
          </div>
          <ScriptedActionListEditor
            label="Effect"
            items={[a.effect]}
            onChange={(next) => {
              if (next.length === 0) return;
              onChange(items.map((x, j) => (j === i ? { ...x, effect: next[0] } : x)));
            }}
          />
        </li>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...items,
            {
              id: `action-${Math.random().toString(36).slice(2, 6)}`,
              label: "New action",
              effect: { kind: "draw_cards", target: "active_player", params: { count: 1 } },
            },
          ])
        }
        className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-100 hover:bg-ink-700"
      >
        + Player action
      </button>
    </ul>
  );
}

function CardActionListEditor({
  items,
  onChange,
}: {
  items: CardActionDef[];
  onChange: (next: CardActionDef[]) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((a, i) => (
        <li
          key={a.id}
          className="grid grid-cols-[120px_1fr_140px_1fr_28px] items-end gap-2 rounded border border-ink-800 bg-ink-950/40 p-3"
        >
          <Field label="Id">
            <Input value={a.id} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, id: v } : x)))} />
          </Field>
          <Field label="Label">
            <Input value={a.label} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
          </Field>
          <Field label="Effect kind">
            <select
              value={a.cardEffect.kind}
              onChange={(e) => {
                const kind = e.target.value as CardActionDef["cardEffect"]["kind"];
                let cardEffect: CardActionDef["cardEffect"] = { kind: "toggle_tapped" };
                if (kind === "toggle_tapped") cardEffect = { kind };
                else if (kind === "toggle_facedown") cardEffect = { kind };
                else if (kind === "increment_counter") cardEffect = { kind, counter: "counter", delta: 1 };
                else if (kind === "set_counter") cardEffect = { kind, counter: "counter", value: 0 };
                else if (kind === "move_to_zone_kind") cardEffect = { kind, zoneKind: "discard" };
                else if (kind === "destroy") cardEffect = { kind };
                onChange(items.map((x, j) => (j === i ? { ...x, cardEffect } : x)));
              }}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
            >
              {["toggle_tapped", "toggle_facedown", "increment_counter", "set_counter", "move_to_zone_kind", "destroy"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effect args (JSON)">
            <Input
              value={JSON.stringify(a.cardEffect)}
              onChange={(v) => {
                try {
                  const parsed = JSON.parse(v);
                  onChange(items.map((x, j) => (j === i ? { ...x, cardEffect: parsed } : x)));
                } catch {
                  // ignore mid-typing
                }
              }}
            />
          </Field>
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="mt-4 h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
          >
            ×
          </button>
        </li>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...items,
            {
              id: `card-${Math.random().toString(36).slice(2, 6)}`,
              label: "New card action",
              cardEffect: { kind: "toggle_tapped" },
            },
          ])
        }
        className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-100 hover:bg-ink-700"
      >
        + Card action
      </button>
    </ul>
  );
}

/* ---------------------------------------------------------------------- */
/* Bits                                                                    */
/* ---------------------------------------------------------------------- */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded border border-ink-700 bg-ink-900/40 p-4">
      <div className="flex items-baseline justify-between border-b border-ink-800 pb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-300">{title}</h3>
        {subtitle && <span className="text-[10px] text-ink-500">{subtitle}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
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
  onCommit,
}: {
  value: string;
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={() => {
        if (onCommit && draft !== value) onCommit(draft);
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
    />
  );
}

function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.round(n));
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
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

/**
 * Coerce arbitrary configJson into a usable RulesetConfig — fills in
 * any missing fields with defaults so the editor can render even on
 * a freshly-created ruleset whose configJson is `{}`.
 */
function coerceConfig(input: unknown): RulesetConfig {
  const def = DEFAULT_RULESET_CONFIG;
  if (!input || typeof input !== "object") return JSON.parse(JSON.stringify(def));
  const c = input as Partial<RulesetConfig>;
  return {
    playerSetup: { ...def.playerSetup, ...(c.playerSetup ?? {}) },
    phases: Array.isArray(c.phases) ? c.phases : def.phases,
    winConditions: Array.isArray(c.winConditions) ? c.winConditions : def.winConditions,
    customActions: Array.isArray(c.customActions) ? c.customActions : def.customActions,
    cardActions: Array.isArray(c.cardActions) ? c.cardActions : def.cardActions,
    autoAdvancePhases: c.autoAdvancePhases ?? def.autoAdvancePhases,
  };
}
