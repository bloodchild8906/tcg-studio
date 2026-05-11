import { useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Card, CardSet, Faction } from "@/lib/apiTypes";

/**
 * Project Insights view (sec 30 ish — design-time analytics).
 *
 * Pure-client analytics across the project's cards. The aim is to give
 * authors a fast read on their game's distribution: rarity balance,
 * faction representation, set sizes, mana / cost curve, status
 * pipeline (idea → released).
 *
 * Why pure client: card counts top out in the hundreds for typical
 * projects; round-tripping per-stat would feel laggy and the numbers
 * wouldn't be more accurate than what we can derive from the existing
 * `/api/v1/cards` payload. If a project ever grows past ~10k cards
 * we'll add a server-side aggregation endpoint.
 *
 * Each chart is its own component so authors can pick favorites and
 * we can swap implementations without rewriting the page.
 */
export function InsightsView() {
  const project = useDesigner(selectActiveProject);
  const [cards, setCards] = useState<Card[]>([]);
  const [sets, setSets] = useState<CardSet[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setCards([]);
      setSets([]);
      setFactions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.listCards({ projectId: project.id }),
      api.listSets({ projectId: project.id }).catch(() => []),
      api.listFactions({ projectId: project.id }).catch(() => []),
    ])
      .then(([c, s, f]) => {
        if (cancelled) return;
        setCards(c);
        setSets(s);
        setFactions(f);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to see its insights.</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <header>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Project: {project.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-ink-50">Insights</h1>
          <p className="mt-1 text-xs text-ink-400">
            Design-time analytics across {cards.length} card{cards.length === 1 ? "" : "s"}.
            Distributions are computed in your browser — no server round-trip.
          </p>
        </header>

        {error && (
          <div className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        {loading && cards.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-500">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="rounded border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-500">
            No cards yet — head to the Cards view to import or author some.
          </p>
        ) : (
          <>
            <SummaryStrip cards={cards} sets={sets} factions={factions} />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <RarityChart cards={cards} />
              <StatusChart cards={cards} />
              <FactionChart cards={cards} factions={factions} />
              <SetChart cards={cards} sets={sets} />
              <CostCurveChart cards={cards} />
              <CardTypeChart cards={cards} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Summary strip                                                           */
/* ====================================================================== */

function SummaryStrip({
  cards,
  sets,
  factions,
}: {
  cards: Card[];
  sets: CardSet[];
  factions: Faction[];
}) {
  const released = cards.filter((c) => c.status === "released" || c.status === "approved").length;
  const draft = cards.filter((c) => c.status === "draft" || c.status === "idea").length;
  const blocked = cards.filter(
    (c) => c.status === "needs_review" || c.status === "rules_review" || c.status === "art_needed",
  ).length;
  const orphans = cards.filter((c) => !c.setId).length;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat label="Total cards" value={cards.length} />
      <Stat label="Released" value={released} accent="emerald" />
      <Stat label="In progress" value={blocked} accent="amber" />
      <Stat label="Draft" value={draft} />
      <Stat label="Without set" value={orphans} accent={orphans > 0 ? "danger" : undefined} hint={`of ${sets.length} set${sets.length === 1 ? "" : "s"}`} />
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: "emerald" | "amber" | "danger";
}) {
  const accentCls =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "amber"
      ? "text-amber-300"
      : accent === "danger"
      ? "text-danger-500"
      : "text-ink-50";
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className={["mt-1 text-2xl font-semibold tabular-nums", accentCls].join(" ")}>{value}</p>
      {hint && <p className="mt-1 text-[10px] text-ink-500">{hint}</p>}
    </div>
  );
}

/* ====================================================================== */
/* Charts                                                                  */
/* ====================================================================== */

function RarityChart({ cards }: { cards: Card[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      const r = (c.rarity ?? "").trim() || "(unset)";
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [cards]);

  // Standard rarity colors — Common / Uncommon / Rare / Mythic / Special
  // map to silver / cool blue / gold / orange / purple. Unknown rarities
  // fall back to a neutral gray.
  const colors: Record<string, string> = {
    common: "#a8acb8",
    uncommon: "#5b9bd5",
    rare: "#d4a24c",
    mythic: "#e85d3a",
    special: "#9b6ac6",
    "(unset)": "#3a4258",
  };

  return (
    <ChartCard title="Rarity distribution" subtitle={`${cards.length} cards`}>
      <BarList
        items={counts.map(([k, v]) => ({
          label: k,
          value: v,
          color: colors[k.toLowerCase()] ?? "#7a7f95",
        }))}
        max={Math.max(...counts.map(([, v]) => v), 1)}
      />
    </ChartCard>
  );
}

function StatusChart({ cards }: { cards: Card[] }) {
  // Order matches the spec's status pipeline (sec 18.3) so the chart
  // visually reads as a workflow: ideas → drafts → review → released.
  const order = [
    "idea",
    "draft",
    "needs_review",
    "rules_review",
    "art_needed",
    "art_complete",
    "balance_testing",
    "approved",
    "released",
    "deprecated",
    "banned",
    "archived",
  ];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return order
      .filter((s) => m.has(s))
      .map((s) => [s, m.get(s) ?? 0] as [string, number])
      .concat(
        Array.from(m.entries()).filter(([s]) => !order.includes(s)),
      );
  }, [cards]);

  const colors: Record<string, string> = {
    idea: "#7a7f95",
    draft: "#7a7f95",
    needs_review: "#d4a24c",
    rules_review: "#d4a24c",
    art_needed: "#e85d3a",
    art_complete: "#e85d3a",
    balance_testing: "#5b9bd5",
    approved: "#5b9bd5",
    released: "#4ed1a2",
    deprecated: "#9b6ac6",
    banned: "#b34a40",
    archived: "#3a4258",
  };

  return (
    <ChartCard title="Status pipeline" subtitle="Where cards are in the workflow">
      <BarList
        items={counts.map(([k, v]) => ({
          label: k.replace(/_/g, " "),
          value: v,
          color: colors[k] ?? "#7a7f95",
        }))}
        max={Math.max(...counts.map(([, v]) => v), 1)}
      />
    </ChartCard>
  );
}

function FactionChart({ cards, factions }: { cards: Card[]; factions: Faction[] }) {
  const factionBySlug = useMemo(() => {
    const m = new Map<string, Faction>();
    for (const f of factions) m.set(f.slug, f);
    return m;
  }, [factions]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      const data = (c.dataJson as Record<string, unknown> | null) ?? {};
      const mono = typeof data.faction === "string" ? data.faction : null;
      const multi = Array.isArray(data.factions) ? (data.factions as string[]) : null;
      const slugs = multi && multi.length > 0 ? multi : mono ? [mono] : ["(unset)"];
      for (const slug of slugs) {
        m.set(slug, (m.get(slug) ?? 0) + 1);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [cards]);

  return (
    <ChartCard
      title="Faction representation"
      subtitle={
        factions.length === 0
          ? "No factions defined yet"
          : `Across ${factions.length} faction${factions.length === 1 ? "" : "s"}`
      }
    >
      <BarList
        items={counts.map(([slug, v]) => {
          const f = factionBySlug.get(slug);
          return {
            label: f?.name ?? slug,
            value: v,
            color: f?.color ?? (slug === "(unset)" ? "#3a4258" : "#7a7f95"),
          };
        })}
        max={Math.max(...counts.map(([, v]) => v), 1)}
      />
    </ChartCard>
  );
}

function SetChart({ cards, sets }: { cards: Card[]; sets: CardSet[] }) {
  const setById = useMemo(() => {
    const m = new Map<string, CardSet>();
    for (const s of sets) m.set(s.id, s);
    return m;
  }, [sets]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      const key = c.setId ?? "__none__";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [cards]);

  return (
    <ChartCard title="Set sizes" subtitle={`${sets.length} set${sets.length === 1 ? "" : "s"}`}>
      <BarList
        items={counts.map(([key, v]) => {
          if (key === "__none__") {
            return { label: "(no set)", value: v, color: "#3a4258" };
          }
          const s = setById.get(key);
          return {
            label: s ? `${s.code} · ${s.name}` : "(deleted)",
            value: v,
            color: "#5b9bd5",
          };
        })}
        max={Math.max(...counts.map(([, v]) => v), 1)}
      />
    </ChartCard>
  );
}

function CardTypeChart({ cards }: { cards: Card[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      m.set(c.cardTypeId, (m.get(c.cardTypeId) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [cards]);

  const cardTypes = useDesigner((s) => s.cardTypes);
  const ctById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ct of cardTypes) m.set(ct.id, ct.name);
    return m;
  }, [cardTypes]);

  return (
    <ChartCard title="Card type breakdown" subtitle="Distribution by template">
      <BarList
        items={counts.map(([id, v]) => ({
          label: ctById.get(id) ?? id.slice(0, 8),
          value: v,
          color: "#9b6ac6",
        }))}
        max={Math.max(...counts.map(([, v]) => v), 1)}
      />
    </ChartCard>
  );
}

function CostCurveChart({ cards }: { cards: Card[] }) {
  // The "cost curve" is a histogram of numeric costs across the card
  // pool. We probe `dataJson.cost`, `dataJson.mana`, `dataJson.energy`
  // in that order — whichever resolves to a finite number first wins.
  // This is heuristic by design: not every game has a cost field, and
  // we don't want to enforce a schema across all projects.
  const numeric = useMemo(() => {
    const m = new Map<number, number>();
    let withoutCost = 0;
    for (const c of cards) {
      const data = (c.dataJson as Record<string, unknown> | null) ?? {};
      const candidates = [data.cost, data.mana, data.energy];
      let n: number | null = null;
      for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          n = candidate;
          break;
        }
        if (typeof candidate === "string") {
          const parsed = Number.parseInt(candidate, 10);
          if (Number.isFinite(parsed)) {
            n = parsed;
            break;
          }
        }
      }
      if (n == null) withoutCost++;
      else m.set(n, (m.get(n) ?? 0) + 1);
    }
    return { buckets: m, withoutCost };
  }, [cards]);

  const sorted = Array.from(numeric.buckets.entries()).sort((a, b) => a[0] - b[0]);
  const max = Math.max(...sorted.map(([, v]) => v), 1);

  if (sorted.length === 0) {
    return (
      <ChartCard title="Cost curve" subtitle="No numeric cost field detected">
        <p className="text-[11px] text-ink-500">
          Add a <code className="font-mono">cost</code>, <code className="font-mono">mana</code>,
          or <code className="font-mono">energy</code> field to your card schema and the curve
          will populate.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Cost curve"
      subtitle={`${cards.length - numeric.withoutCost} cards with cost · ${numeric.withoutCost} without`}
    >
      <div className="flex items-end gap-1.5">
        {sorted.map(([cost, count]) => {
          const heightPct = (count / max) * 100;
          return (
            <div key={cost} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-ink-400">{count}</span>
              <div
                className="w-full rounded-t bg-accent-500/40"
                style={{
                  height: `${Math.max(2, heightPct)}%`,
                  minHeight: 2,
                  maxHeight: 120,
                }}
              />
              <span className="font-mono text-[10px] text-ink-500">{cost}</span>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

/* ====================================================================== */
/* Reusable chart bits                                                     */
/* ====================================================================== */

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink-50">{title}</h3>
        {subtitle && <span className="text-[10px] text-ink-500">{subtitle}</span>}
      </header>
      <div className="min-h-[140px]">{children}</div>
    </section>
  );
}

function BarList({
  items,
  max,
}: {
  items: Array<{ label: string; value: number; color: string }>;
  max: number;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-ink-500">No data.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => {
        const pct = (item.value / max) * 100;
        return (
          <li key={`${item.label}-${i}`} className="grid grid-cols-[120px_1fr_42px] items-center gap-2 text-xs">
            <span className="truncate text-ink-300" title={item.label}>
              {item.label}
            </span>
            <div className="h-3 overflow-hidden rounded bg-ink-950">
              <div
                className="h-full"
                style={{
                  width: `${Math.max(2, pct)}%`,
                  background: item.color,
                }}
              />
            </div>
            <span className="text-right font-mono tabular-nums text-ink-100">{item.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
