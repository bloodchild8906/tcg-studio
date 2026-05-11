import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { Card, CardSet, PackKind, PackProfile, PackRules, PackSlot } from "@/lib/apiTypes";
import {
  DEFAULT_PACK_PROFILE,
  PACK_KIND_DEFAULTS,
  generatePack,
  normalizePackRules,
  type PackResult,
} from "@/lib/packs";

/**
 * Pack generator modal (sec 27.4) — multi-profile.
 *
 * Layout:
 *   • Top tabs    — one per pack profile (Booster / Starter Deck / …)
 *                   plus a "+" button to add. Profiles are named and
 *                   typed by `kind`; the kind drives sensible defaults
 *                   when adding a new one.
 *   • Left pane   — slot rules + duplicates toggle for the active
 *                   profile. Save button persists the full profile list.
 *   • Right pane  — pull a sample pack against the active profile, with
 *                   a seed input for reproducible playtests.
 *
 * Why a tabbed UI instead of a master-detail list: pack profiles are
 * usually 2-4 per set (Booster, Starter, Promo, Draft) and the user
 * wants to flip between them quickly while comparing slot counts. Tabs
 * keep all profiles one click away.
 */
export function PackGeneratorModal({
  set,
  open,
  onClose,
  onSaved,
}: {
  set: CardSet | null;
  open: boolean;
  onClose: () => void;
  onSaved: (set: CardSet) => void;
}) {
  const [rules, setRules] = useState<PackRules>({ profiles: [DEFAULT_PACK_PROFILE] });
  const [activeProfileId, setActiveProfileId] = useState<string>(DEFAULT_PACK_PROFILE.id);
  const [cards, setCards] = useState<Card[]>([]);
  const [pack, setPack] = useState<PackResult | null>(null);
  const [seed, setSeed] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !set) return;
    const normalised = normalizePackRules(set.packRulesJson ?? {});
    setRules(normalised);
    setActiveProfileId(normalised.profiles[0]?.id ?? "");
    setPack(null);
    setError(null);
    setSeed("");
    void api
      .listCards({ projectId: set.projectId, setId: set.id })
      .then(setCards)
      .catch((err) => setError(err instanceof Error ? err.message : "load failed"));
  }, [open, set]);

  const rarityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      const r = (c.rarity ?? "").toLowerCase() || "(unset)";
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return m;
  }, [cards]);

  if (!open || !set) return null;

  const activeProfile =
    rules.profiles.find((p) => p.id === activeProfileId) ?? rules.profiles[0];

  function patchProfile(patch: Partial<PackProfile>) {
    if (!activeProfile) return;
    setRules({
      profiles: rules.profiles.map((p) =>
        p.id === activeProfile.id ? { ...p, ...patch } : p,
      ),
    });
  }

  function setSlot(idx: number, slotPatch: Partial<PackSlot>) {
    if (!activeProfile) return;
    const slots = activeProfile.slots.map((s, i) => (i === idx ? { ...s, ...slotPatch } : s));
    patchProfile({ slots });
  }

  function addSlot() {
    if (!activeProfile) return;
    patchProfile({ slots: [...activeProfile.slots, { rarity: "common", count: 1 }] });
  }

  function removeSlot(idx: number) {
    if (!activeProfile) return;
    patchProfile({ slots: activeProfile.slots.filter((_, i) => i !== idx) });
  }

  function addProfile(kind: PackKind) {
    const tpl = PACK_KIND_DEFAULTS[kind];
    const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
    const next: PackProfile = {
      id,
      name: tpl.name,
      kind,
      slots: tpl.slots.map((s) => ({ ...s })),
      duplicates: tpl.duplicates,
    };
    setRules({ profiles: [...rules.profiles, next] });
    setActiveProfileId(id);
  }

  function deleteProfile(id: string) {
    if (rules.profiles.length === 1) {
      setError("Keep at least one profile — replace its slots instead of deleting.");
      return;
    }
    if (!confirm(`Delete pack profile "${rules.profiles.find((p) => p.id === id)?.name}"?`))
      return;
    const remaining = rules.profiles.filter((p) => p.id !== id);
    setRules({ profiles: remaining });
    if (activeProfileId === id) setActiveProfileId(remaining[0]?.id ?? "");
  }

  async function persist() {
    if (!set) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateSet(set.id, {
        packRulesJson: rules,
      } as Partial<CardSet>);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  function pull() {
    if (!activeProfile) return;
    if (cards.length === 0) {
      setError("Set has no cards — add some before pulling a pack.");
      return;
    }
    const numericSeed = typeof seed === "number" ? seed : Number(seed);
    const result = generatePack({
      profile: activeProfile,
      cards,
      seed: Number.isFinite(numericSeed) && seed !== "" ? numericSeed : undefined,
    });
    setPack(result);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pack generator: ${set.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex h-[90vh] w-[min(960px,96vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Pack profiles</h2>
            <p className="text-[11px] text-ink-500">
              {set.name} ({set.code}) · {cards.length} card{cards.length === 1 ? "" : "s"} in set ·{" "}
              {rules.profiles.length} profile{rules.profiles.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        {/* Profile tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-700 px-3 py-2">
          {rules.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveProfileId(p.id)}
              className={[
                "inline-flex shrink-0 items-center gap-1.5 rounded-t border px-3 py-1.5 text-xs",
                p.id === activeProfileId
                  ? "border-accent-500/40 border-b-transparent bg-accent-500/15 text-accent-200"
                  : "border-ink-800 bg-ink-900 text-ink-300 hover:bg-ink-800",
              ].join(" ")}
            >
              <KindBadge kind={p.kind} />
              {p.name}
              <span className="font-mono text-[10px] text-ink-500">
                ×{p.slots.reduce((n, s) => n + s.count, 0)}
              </span>
            </button>
          ))}
          <AddProfileMenu onPick={addProfile} />
        </div>

        {activeProfile ? (
          <div className="grid flex-1 grid-cols-[1fr_1fr] overflow-hidden">
            <section className="overflow-y-auto border-r border-ink-700 p-4">
              <div className="mb-3 grid grid-cols-[1fr_140px_28px] items-center gap-2">
                <label className="block space-y-1">
                  <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                    Profile name
                  </span>
                  <input
                    type="text"
                    value={activeProfile.name}
                    onChange={(e) => patchProfile({ name: e.target.value })}
                    className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                    Kind
                  </span>
                  <select
                    value={activeProfile.kind}
                    onChange={(e) => patchProfile({ kind: e.target.value as PackKind })}
                    className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                  >
                    {Object.keys(PACK_KIND_DEFAULTS).map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => deleteProfile(activeProfile.id)}
                  title="Delete profile"
                  className="mt-4 h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
                >
                  ×
                </button>
              </div>

              <h3 className="mb-2 text-xs font-medium text-ink-50">Slots</h3>
              <p className="mb-2 text-[11px] text-ink-500">
                The sampler pulls each slot's <span className="text-ink-300">count</span> cards
                filtered by <span className="text-ink-300">rarity</span>.
              </p>
              <ul className="space-y-2">
                {activeProfile.slots.map((slot, idx) => (
                  <li
                    key={idx}
                    className="grid grid-cols-[1fr_72px_28px] items-end gap-2 rounded border border-ink-800 bg-ink-950/40 p-2"
                  >
                    <label className="block space-y-1">
                      <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                        Rarity
                      </span>
                      <input
                        type="text"
                        value={slot.rarity}
                        onChange={(e) => setSlot(idx, { rarity: e.target.value })}
                        list={`pack-rarity-${activeProfile.id}-${idx}`}
                        className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                      />
                      <datalist id={`pack-rarity-${activeProfile.id}-${idx}`}>
                        {Array.from(rarityCounts.keys()).map((r) => (
                          <option key={r} value={r} />
                        ))}
                      </datalist>
                    </label>
                    <label className="block space-y-1">
                      <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                        Count
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={slot.count}
                        onChange={(e) =>
                          setSlot(idx, { count: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeSlot(idx)}
                      title="Remove slot"
                      className="h-7 rounded border border-ink-700 bg-ink-900 text-ink-500 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={addSlot}
                className="mt-3 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
              >
                + Add slot
              </button>

              <label className="mt-4 flex items-center gap-2 text-xs text-ink-100">
                <input
                  type="checkbox"
                  checked={!!activeProfile.duplicates}
                  onChange={(e) => patchProfile({ duplicates: e.target.checked })}
                  className="h-3 w-3 cursor-pointer accent-accent-500"
                />
                <span>Allow duplicates within one pack</span>
              </label>

              <h3 className="mt-5 text-xs font-medium text-ink-50">Pool</h3>
              <ul className="mt-2 space-y-1 text-[11px]">
                {Array.from(rarityCounts.entries()).map(([r, n]) => (
                  <li
                    key={r}
                    className="flex items-center justify-between rounded border border-ink-800 px-2 py-1 text-ink-400"
                  >
                    <span className="font-mono">{r}</span>
                    <span className="text-ink-300">{n}</span>
                  </li>
                ))}
                {rarityCounts.size === 0 && (
                  <li className="text-[11px] text-ink-600">
                    No cards yet — add cards to this set first.
                  </li>
                )}
              </ul>

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={persist}
                  disabled={busy}
                  className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Save profiles"}
                </button>
              </div>
            </section>

            <section className="overflow-y-auto p-4">
              <h3 className="mb-2 text-xs font-medium text-ink-50">Sample pack</h3>
              <p className="mb-2 text-[11px] text-ink-500">
                Rolls the active profile (<span className="text-ink-300">{activeProfile.name}</span>).
              </p>
              <div className="mb-3 flex items-center gap-2">
                <label className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs">
                  <span className="text-[10px] uppercase tracking-wider text-ink-500">Seed</span>
                  <input
                    type="text"
                    value={seed}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") setSeed("");
                      else if (/^\d+$/.test(v)) setSeed(Number(v));
                    }}
                    placeholder="random"
                    className="block w-20 bg-transparent text-xs tabular-nums text-ink-100 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={pull}
                  className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
                >
                  Pull pack
                </button>
              </div>

              {pack ? (
                <>
                  <ul className="space-y-1.5">
                    {pack.cards.map((c, i) => (
                      <li
                        key={`${c.id}-${i}`}
                        className="flex items-center gap-2 rounded border border-ink-800 bg-ink-950/40 px-2 py-1.5 text-xs"
                      >
                        <span className="font-mono text-[10px] text-ink-500">{i + 1}</span>
                        <span className="truncate text-ink-100">{c.name}</span>
                        <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-300">
                          {c.rarity || "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pack.slots.some((s) => s.delivered < s.requested) && (
                    <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
                      <p className="font-semibold">Some slots fell short:</p>
                      <ul className="mt-1 space-y-0.5">
                        {pack.slots
                          .filter((s) => s.delivered < s.requested)
                          .map((s, i) => (
                            <li key={i}>
                              • {s.rarity}: {s.delivered}/{s.requested}
                              {s.missing ? ` — ${s.missing}` : ""}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded border border-dashed border-ink-700 p-6 text-center text-xs text-ink-500">
                  Click "Pull pack" to draw a sample.
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-500">
            No profile selected.
          </div>
        )}

        {error && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline "+ Add" menu for new profile kinds. Each option seeds the new
 * profile with its kind-specific defaults from `PACK_KIND_DEFAULTS`.
 */
function AddProfileMenu({ onPick }: { onPick: (kind: PackKind) => void }) {
  return (
    <details className="relative ml-1 shrink-0">
      <summary className="cursor-pointer list-none rounded-t border border-ink-800 bg-ink-900 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 [&::-webkit-details-marker]:hidden">
        + Add profile
      </summary>
      <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded border border-ink-700 bg-ink-800 shadow-lg">
        {Object.keys(PACK_KIND_DEFAULTS).map((k) => (
          <button
            key={k}
            type="button"
            onClick={(e) => {
              const details = e.currentTarget.closest("details") as HTMLDetailsElement | null;
              if (details) details.open = false;
              onPick(k as PackKind);
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-ink-100 hover:bg-ink-700"
          >
            {k.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </details>
  );
}

function KindBadge({ kind }: { kind: PackKind }) {
  // Tiny visual marker so the user can scan the tab strip and tell
  // booster vs deck vs draft at a glance.
  const map: Record<PackKind, string> = {
    booster: "B",
    starter_deck: "S",
    draft: "D",
    promo: "P",
    fixed: "F",
    random: "R",
    faction_pack: "Fa",
    sealed_pool: "SP",
    commander_deck: "C",
    custom: "·",
  };
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-ink-800 text-[9px] font-bold text-ink-300">
      {map[kind] ?? "·"}
    </span>
  );
}
