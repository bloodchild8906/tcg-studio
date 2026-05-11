import { useEffect, useState } from "react";
import {
  selectActiveCardType,
  selectActiveProject,
  selectNavLevel,
  useDesigner,
} from "@/store/designerStore";
import * as api from "@/lib/api";
import { downloadProjectExport } from "@/lib/projectExport";
import { bootstrapProject } from "@/lib/projectQuickstart";
import { downloadCockatriceCarddatabase } from "@/lib/exportCockatrice";
import type {
  PlatformAnnouncement,
  PlatformBillingSummary,
  PlatformTenantRow,
} from "@/lib/api";

/**
 * Tenant-type-driven dashboard preset.
 *
 * Each archetype gets a tailored greeting + suggested-action list that
 * surfaces above the project stat tiles. The tiles themselves are
 * shared because the underlying data — card types, sets, factions —
 * is the same for everyone; the difference is what to do next.
 */
const TYPE_PRESETS: Record<
  string,
  {
    label: string;
    headline: string;
    description: string;
    suggestions: Array<{
      title: string;
      body: string;
      target: "card_types" | "cards" | "cms" | "marketplace" | "sets" | "rules" | "playtest" | "lore" | "decks" | "platform" | "tasks" | "messages" | "planning";
    }>;
  }
> = {
  solo: {
    label: "Solo Creator",
    headline: "Your studio, solo workflow.",
    description:
      "Optimized for one designer shipping a complete game end-to-end. Project quickstart, fast publishing, no team friction.",
    suggestions: [
      {
        title: "Define a card type",
        body: "Set the layout + schema for your first card archetype.",
        target: "card_types",
      },
      {
        title: "Start authoring cards",
        body: "Fill the schema with content; the dashboard counters fly up.",
        target: "cards",
      },
      {
        title: "Playtest a hand",
        body: "Manual playtest table — load decks, draw, move cards.",
        target: "playtest",
      },
    ],
  },
  studio: {
    label: "Indie Studio",
    headline: "Studio production view.",
    description:
      "Track your in-flight set, team activity, and what's blocked on review.",
    suggestions: [
      {
        title: "Sets in production",
        body: "Drive the next release through draft → review → released.",
        target: "sets",
      },
      {
        title: "Open review queue",
        body: "Cards waiting on approval show up in the Cards view filter.",
        target: "cards",
      },
      {
        title: "Sprint planning",
        body: "Milestone progress and team workload at a glance.",
        target: "planning",
      },
    ],
  },
  publisher: {
    label: "Publisher",
    headline: "Multi-game publisher console.",
    description:
      "Roll up every game in this workspace, see release calendar, and manage the storefront.",
    suggestions: [
      {
        title: "Public site & marketing",
        body: "Manage the studio's public CMS pages and announcements.",
        target: "cms",
      },
      {
        title: "Marketplace storefront",
        body: "Curate which themes, frame packs, and starter kits your imprints publish.",
        target: "marketplace",
      },
      {
        title: "Cross-project audit",
        body: "Open the Tasks view to see in-flight work across every game.",
        target: "tasks",
      },
    ],
  },
  school: {
    label: "School / Education",
    headline: "Classroom workspace.",
    description:
      "Each student or team gets a project. Track assignments, gallery progress, and submission status.",
    suggestions: [
      {
        title: "Class roster",
        body: "Invite students and assign them to project teams.",
        target: "tasks",
      },
      {
        title: "Set the rubric",
        body: "Card types here are assignment templates — schemas the class fills in.",
        target: "card_types",
      },
      {
        title: "Showcase gallery",
        body: "Publish approved student work to the public gallery.",
        target: "cms",
      },
    ],
  },
  reseller: {
    label: "Reseller",
    headline: "White-label reseller console.",
    description:
      "Provision and manage child tenants for your clients. Curate the plugin marketplace and brand defaults.",
    suggestions: [
      {
        title: "Tenant directory",
        body: "List, suspend, and provision child tenants from the platform admin.",
        target: "platform",
      },
      {
        title: "Curated marketplace",
        body: "Pick which plugins and themes your clients can install.",
        target: "marketplace",
      },
      {
        title: "Brand defaults",
        body: "Set the parent brand identity that child tenants inherit.",
        target: "cms",
      },
    ],
  },
};

/**
 * Dashboard view — dispatches to a level-appropriate dashboard.
 *
 * Per the capability matrix, each level has a distinct purpose:
 *   • Platform — system stats, tenant directory, payments rollup,
 *     announcements. NOT card design tools, NOT a per-tenant view.
 *   • Tenant — project portfolio, member activity, plugin/billing
 *     status, rolled-up project metrics. NO design tools here either.
 *   • Project — the working studio: card types, cards, sets, decks,
 *     boards, rules, abilities, lore. Tenant-type-driven layout
 *     (solo / studio / publisher / school / reseller).
 *
 * Each one is a separate component with its own layout because the
 * audience and the things-they-came-here-to-do are genuinely
 * different. Sharing a component would mean each surface fights to
 * not be ugly for the others.
 */
export function DashboardView() {
  const navLevel = useDesigner(selectNavLevel);
  const platformRole = useDesigner((s) => s.platformRole);

  if (navLevel === "platform") {
    return platformRole ? <PlatformDashboard /> : <PlatformVisitorDashboard />;
  }
  if (navLevel === "project") {
    return <ProjectDashboard />;
  }
  return <TenantDashboard />;
}

/**
 * Project-scoped dashboard. The historical "DashboardView" body —
 * tenant-type-driven greeting, project stat tiles, quickstart
 * bootstrap, and shortcuts to the design tools.
 */
function ProjectDashboard() {
  const project = useDesigner(selectActiveProject);
  const cardType = useDesigner(selectActiveCardType);
  const cardTypes = useDesigner((s) => s.cardTypes);
  const cards = useDesigner((s) => s.cards);
  const setView = useDesigner((s) => s.setView);
  const activeTenant = useDesigner((s) =>
    s.tenants.find((t) => t.slug === s.activeTenantSlug) ?? null,
  );
  const tenantType = activeTenant?.tenantType ?? "studio";
  const preset = TYPE_PRESETS[tenantType] ?? TYPE_PRESETS.studio;

  // Load secondary counters lazily — these aren't in the central store
  // (it's intentionally lean) so we just probe the count endpoints when
  // the dashboard is open. One-shot per project change is fine.
  const [counts, setCounts] = useState({
    sets: 0,
    blocks: 0,
    factions: 0,
    keywords: 0,
    lore: 0,
    assets: 0,
    decks: 0,
    boards: 0,
    rulesets: 0,
    abilities: 0,
  });
  useEffect(() => {
    if (!project) {
      setCounts({
        sets: 0,
        blocks: 0,
        factions: 0,
        keywords: 0,
        lore: 0,
        assets: 0,
        decks: 0,
        boards: 0,
        rulesets: 0,
        abilities: 0,
      });
      return;
    }
    let cancelled = false;
    void Promise.all([
      api.listSets({ projectId: project.id }).catch(() => []),
      api.listBlocks({ projectId: project.id }).catch(() => []),
      api.listFactions({ projectId: project.id }).catch(() => []),
      api.listKeywords({ projectId: project.id }).catch(() => []),
      api.listLore({ projectId: project.id }).catch(() => []),
      api.listAssets({ projectId: project.id }).catch(() => []),
      api.listDecks({ projectId: project.id }).catch(() => []),
      api.listBoards({ projectId: project.id }).catch(() => []),
      api.listRulesets({ projectId: project.id }).catch(() => []),
      api.listAbilities({ projectId: project.id }).catch(() => []),
    ]).then(
      ([sets, blocks, factions, keywords, lore, assets, decks, boards, rulesets, abilities]) => {
        if (cancelled) return;
        setCounts({
          sets: sets.length,
          blocks: blocks.length,
          factions: factions.length,
          keywords: keywords.length,
          lore: lore.length,
          assets: assets.length,
          decks: decks.length,
          boards: boards.length,
          rulesets: rulesets.length,
          abilities: abilities.length,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project]);

  // Project is "empty enough to bootstrap" when it has no rulesets,
  // boards, or card types yet. We use those three as the core gates
  // because a brand-new project literally can't playtest without all
  // three. Cards / sets / decks aren't bootstrapped — they're authored
  // by the user once the scaffolding is in place.
  const isEmpty =
    !!project && cardTypes.length === 0 && counts.boards === 0 && counts.rulesets === 0;

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-5xl p-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              {preset.label}
              {project && <> · Project: {project.name}</>}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-50">
              {preset.headline}
            </h1>
            <p className="mt-1 text-sm text-ink-400">{preset.description}</p>
          </div>
          {project && <ProjectActions project={project} setView={setView} />}
        </header>

        {/* Tenant-type-specific suggestions. Three quick-jump tiles
         *  tuned to the archetype. The rest of the dashboard (stat
         *  tiles + project shortcuts) remains shared because the
         *  underlying data is the same. */}
        <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {preset.suggestions.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setView(s.target)}
              className="rounded-lg border border-ink-800 bg-ink-900 p-3 text-left transition-colors hover:border-accent-500/40 hover:bg-ink-800/40"
            >
              <p className="text-[10px] uppercase tracking-wider text-accent-400">
                Suggested
              </p>
              <p className="mt-1 text-sm font-medium text-ink-100">{s.title}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">{s.body}</p>
            </button>
          ))}
        </section>

        {isEmpty && project && (
          <QuickstartPanel project={project} onDone={() => setView("playtest")} />
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Card types" value={cardTypes.length} onClick={() => setView("card_types")} />
          <StatCard label="Cards" value={cards.length} onClick={() => setView("cards")} />
          <StatCard label="Sets" value={counts.sets} onClick={() => setView("sets")} />
          <StatCard
            label="Blocks"
            value={counts.blocks}
            onClick={() => setView("sets")}
            hint="Manage in the Sets view"
          />
        </section>
        <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Factions" value={counts.factions} onClick={() => setView("factions")} />
          <StatCard label="Keywords" value={counts.keywords} onClick={() => setView("rules")} />
          <StatCard
            label="Abilities"
            value={counts.abilities}
            onClick={() => setView("abilities")}
          />
          <StatCard label="Lore" value={counts.lore} onClick={() => setView("lore")} />
        </section>
        <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Decks" value={counts.decks} onClick={() => setView("decks")} />
          <StatCard label="Boards" value={counts.boards} onClick={() => setView("boards")} />
          <StatCard label="Rulesets" value={counts.rulesets} onClick={() => setView("rulesets")} />
          <StatCard label="Playtest" value="▶" onClick={() => setView("playtest")} />
        </section>
        <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Assets" value={counts.assets} onClick={() => setView("assets")} />
        </section>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ShortcutTile
            title="Card types"
            description="Browse and create card types. Each defines a layout, schema, and variants."
            cta={`Open (${cardTypes.length})`}
            onClick={() => setView("card_types")}
            disabled={!project}
            accent
          />
          <ShortcutTile
            title="Card type designer"
            description={
              cardType
                ? `Continue editing "${cardType.name}".`
                : "Edit a card type's layout, layers, and variant rules."
            }
            cta={cardType ? "Open designer" : "Pick a card type"}
            onClick={() => setView(cardType ? "designer" : "card_types")}
            disabled={!project}
          />
          <ShortcutTile
            title="Cards"
            description={
              cardType
                ? `Author cards under "${cardType.name}" — schema-driven form.`
                : "Pick a card type to see its cards."
            }
            cta="Open cards"
            onClick={() => setView(cardType ? "cards" : "card_types")}
            disabled={!project}
          />
        </section>

        <section className="mt-10">
          <h2 className="text-[11px] uppercase tracking-wider text-ink-400">Up next</h2>
          <ul className="mt-3 space-y-1.5 text-xs text-ink-400">
            <li>• Public card gallery — browse + share released cards (sec 15).</li>
            <li>• Ability graph designer (sec 24).</li>
            <li>• Board layout designer + manual playtest (sec 26 + 30).</li>
            <li>• CMS page builder + public sites (sec 14).</li>
            <li>• Plugin SDK + marketplace (sec 34–35).</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

/**
 * Project-level actions — currently a download-export button. Lives in
 * the dashboard header so authors can grab a backup with one click,
 * regardless of which sub-view they're in. Future companions: import,
 * duplicate-as-new-project, archive.
 */
function ProjectActions({
  project,
  setView: _setView,
}: {
  project: { id: string; name: string; slug: string; description: string; status: string; version: string };
  setView: ReturnType<typeof useDesigner.getState>["setView"];
}) {
  // We track the busy + error state per-action so a slow Cockatrice
  // build doesn't grey out the JSON button or vice versa.
  const [busyKind, setBusyKind] = useState<"json" | "cockatrice" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "json" | "cockatrice", fn: () => Promise<void>) {
    setBusyKind(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busyKind !== null}
          onClick={() => run("json", () => downloadProjectExport(project as never))}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          title="Bundles cards, decks, sets, boards, rulesets, abilities, factions, keywords, and lore into one JSON file."
        >
          {busyKind === "json" ? "Bundling…" : "↓ Project JSON"}
        </button>
        <button
          type="button"
          disabled={busyKind !== null}
          onClick={() =>
            run("cockatrice", () =>
              downloadCockatriceCarddatabase({ project: project as never }),
            )
          }
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          title="Cockatrice custom-set XML — drop into Cockatrice's customsets/ folder to load all cards."
        >
          {busyKind === "cockatrice" ? "Building…" : "↓ Cockatrice XML"}
        </button>
      </div>
      {error && <span className="text-[10px] text-danger-500">{error}</span>}
      <span className="text-[10px] text-ink-500">
        Project JSON for backups · Cockatrice XML for online playtesting.
      </span>
    </div>
  );
}

/**
 * One-click bootstrap for empty projects. Surfaces only when the
 * project has no rulesets / boards / card types — the three pieces a
 * playtest session needs. Once any of those exist, the panel
 * disappears (it'd be noise on a populated dashboard).
 */
function QuickstartPanel({
  project,
  onDone,
}: {
  project: { id: string; name: string; slug: string; description: string; status: string; version: string };
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: string[]; skipped: string[] } | null>(null);
  return (
    <section className="mb-8 rounded-lg border border-accent-500/40 bg-accent-500/5 p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-accent-300">Quickstart</p>
          <h2 className="mt-0.5 text-base font-semibold text-ink-50">Bootstrap this project</h2>
          <p className="mt-1 text-xs text-ink-400">
            One click creates a default <strong className="text-ink-200">duel ruleset</strong>, a{" "}
            <strong className="text-ink-200">1v1 board layout</strong>, and a{" "}
            <strong className="text-ink-200">basic card type</strong> with a sensible schema. From
            there you're ready to author cards and start playtesting.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !!result}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const out = await bootstrapProject(project as never);
              setResult({ created: out.created, skipped: out.skipped });
              // After a brief beat to show what was created, jump to playtest.
              setTimeout(onDone, 1400);
            } catch (err) {
              setError(err instanceof Error ? err.message : "bootstrap failed");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded border border-accent-500/60 bg-accent-500/15 px-4 py-2 text-sm font-medium text-accent-300 hover:border-accent-500/90 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Setting up…" : result ? "✓ Done" : "Bootstrap project"}
        </button>
      </header>
      {error && (
        <p className="text-xs text-danger-500">{error}</p>
      )}
      {result && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-ink-300">
          {result.created.map((c) => (
            <li key={`c-${c}`}>
              <span className="text-emerald-300">+ Created</span> {c}
            </li>
          ))}
          {result.skipped.map((s) => (
            <li key={`s-${s}`} className="text-ink-500">
              — Skipped {s}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  onClick,
  hint,
}: {
  label: string;
  value: number | string;
  onClick?: () => void;
  hint?: string;
}) {
  // Clickable stat cards become navigation shortcuts. Non-clickable
  // ones (project status etc.) render as a static div so the cursor
  // stays accurate.
  const className =
    "block w-full rounded-lg border border-ink-700 bg-ink-900 p-4 text-left transition-colors";
  const interactive = onClick
    ? `${className} hover:border-ink-600 hover:bg-ink-800`
    : className;
  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-50">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-ink-500">{hint}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={interactive}>
      {inner}
    </button>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function ShortcutTile({
  title,
  description,
  cta,
  onClick,
  disabled,
  accent,
}: {
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
        accent
          ? "border-accent-500/40 bg-accent-500/5 hover:border-accent-500/70 hover:bg-accent-500/10"
          : "border-ink-700 bg-ink-900 hover:border-ink-600 hover:bg-ink-800",
        disabled && "cursor-not-allowed opacity-40",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <h3 className="text-sm font-medium text-ink-50">{title}</h3>
      <p className="text-xs text-ink-400">{description}</p>
      <span
        className={[
          "mt-auto inline-flex items-center gap-1 text-[11px] font-medium",
          accent ? "text-accent-300" : "text-ink-300",
        ].join(" ")}
      >
        {cta} →
      </span>
    </button>
  );
}

/* ====================================================================== */
/* PlatformDashboard — super-admin home                                   */
/* ====================================================================== */

/**
 * Platform dashboard — for users with a non-null `platformRole`.
 * Surfaces the things a super-admin actually needs at a glance:
 *   • Active tenant count, MRR, plan distribution.
 *   • Top 6 tenants by recency, with their status pill.
 *   • Active announcements + a CTA to author a new one.
 *   • A jump to the dedicated PlatformView for the full directory.
 *
 * Theme: indigo / amber accents to visually distinguish from the
 * tenant accent color (which the tenant white-labels). Keeps the
 * super-admin shell looking like a different product surface.
 */
function PlatformDashboard() {
  const setView = useDesigner((s) => s.setView);
  const [billing, setBilling] = useState<PlatformBillingSummary | null>(null);
  const [tenants, setTenants] = useState<PlatformTenantRow[]>([]);
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.fetchPlatformBillingSummary().catch(() => null),
      api.listPlatformTenants().catch(() => []),
      api.listActivePlatformAnnouncements().catch(() => []),
    ]).then(([b, t, a]) => {
      if (cancelled) return;
      setBilling(b);
      setTenants(t);
      setAnnouncements(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const mrr = billing ? (billing.monthlyRecurringCents / 100).toFixed(2) : "—";
  const planLine = billing
    ? billing.planDistribution
        .map((p) => `${p.slug} ×${p.count}`)
        .join(" · ") || "no plans"
    : "loading…";

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-ink-950 to-ink-900">
      <div className="mx-auto max-w-6xl p-8">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wider text-indigo-400">
            Platform
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">Mission control</h1>
          <p className="mt-1 text-sm text-ink-400">
            Cross-tenant view. Manage workspaces, watch billing, push announcements.
            No card design tools — those live inside each tenant's projects.
          </p>
          {error && (
            <p className="mt-2 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
              {error}
            </p>
          )}
        </header>

        {/* KPI row — at-a-glance health metrics. Indigo borders so the
         *  surface visually marks itself as platform-scope. */}
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile
            label="Tenants"
            value={billing?.totalTenants ?? "—"}
            hint={`${billing?.activeTenants ?? 0} active`}
            tone="indigo"
          />
          <KpiTile
            label="Monthly recurring"
            value={mrr === "—" ? "—" : `$${mrr}`}
            hint="from active plans"
            tone="emerald"
          />
          <KpiTile
            label="Plan mix"
            value={billing?.planDistribution.length ?? 0}
            hint={planLine}
            tone="amber"
          />
          <KpiTile
            label="Active banners"
            value={announcements.length}
            hint="visible to every tenant"
            tone="violet"
          />
        </section>

        {/* Two-up: recent tenants on the left, announcements on the right.
         *  Both are quick previews that link out to the full PlatformView
         *  (the heavy admin surface) for actual management. */}
        <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Recent tenants"
            cta="Manage tenants →"
            onCta={() => setView("platform")}
          >
            {tenants.length === 0 ? (
              <p className="text-[11px] text-ink-500">No tenants yet.</p>
            ) : (
              <ul className="divide-y divide-ink-800">
                {tenants.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink-100">
                        {t.name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-ink-500">
                        {t.slug}
                      </p>
                    </div>
                    <span className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-300">
                      {t.status}
                    </span>
                    <span className="text-[10px] text-ink-500">
                      {t._count.memberships} member
                      {t._count.memberships === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Active announcements"
            cta="New announcement →"
            onCta={() => setView("platform")}
          >
            {announcements.length === 0 ? (
              <p className="text-[11px] text-ink-500">
                No banners are live. Announcements appear at the top of every
                tenant's admin shell.
              </p>
            ) : (
              <ul className="space-y-2">
                {announcements.slice(0, 4).map((a) => (
                  <li
                    key={a.id}
                    className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5"
                  >
                    <p className="text-[10px] uppercase tracking-wider text-amber-300">
                      {a.kind}
                    </p>
                    <p className="text-xs font-medium text-ink-100">
                      {a.headline}
                    </p>
                    {a.body && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">
                        {a.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        {/* Super-admin shortcuts. Stat tiles at tenant/project scope are
         *  about content; here they're about CONTROL — jump points into
         *  the directory, billing, announcement console. */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ShortcutTile
            title="Tenant directory"
            description="Suspend, reactivate, and inspect every workspace on the platform."
            cta="Open Platform admin"
            onClick={() => setView("platform")}
            accent
          />
          <ShortcutTile
            title="Billing rollup"
            description="MRR, plan distribution, churn signals across the whole platform."
            cta="View billing"
            onClick={() => setView("platform")}
          />
          <ShortcutTile
            title="Marketing & ops"
            description="Author announcement banners, schedule maintenance windows."
            cta="Banner console"
            onClick={() => setView("platform")}
          />
        </section>
      </div>
    </div>
  );
}

/**
 * Platform-host visitor with no platformRole. Friendly placeholder so
 * we don't show a broken empty dashboard to a regular user who landed
 * on the platform host by accident. They get the marketing landing
 * pitch elsewhere; here we just orient them.
 */
function PlatformVisitorDashboard() {
  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-2xl p-12 text-center">
        <p className="text-[11px] uppercase tracking-wider text-ink-500">
          TCGStudio platform
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink-50">
          You're at the platform root.
        </h1>
        <p className="mt-2 text-sm text-ink-400">
          Sign in to your tenant's subdomain to manage your card games. Each
          tenant has its own admin at <code className="font-mono">
            &lt;tenant&gt;.tcgstudio.local/admin
          </code>
          .
        </p>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* TenantDashboard — workspace home                                       */
/* ====================================================================== */

/**
 * Tenant dashboard — for users at `<tenant>.<root>/admin` who haven't
 * picked a project yet. The tenant scope's job is portfolio
 * management + workspace stats: how many projects do I have, what's
 * their status, who's on my team, what plugins are installed,
 * billing health. NO card-design tools — those live one level down.
 */
function TenantDashboard() {
  const projects = useDesigner((s) => s.projects);
  const setView = useDesigner((s) => s.setView);
  const activeTenant = useDesigner(
    (s) => s.tenants.find((t) => t.slug === s.activeTenantSlug) ?? null,
  );

  // Tenant-type preset still drives the headline so an indie studio
  // doesn't get the same copy as a publisher running 8 imprints.
  const tenantType = activeTenant?.tenantType ?? "studio";
  const preset = TYPE_PRESETS[tenantType] ?? TYPE_PRESETS.studio;

  // Tenant member count — different from `store.memberships` (which
  // is the current user's set of tenants, used for the workspace
  // picker). One-shot fetch on mount; tenants don't churn members
  // fast enough to need realtime here.
  const [memberCount, setMemberCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api
      .listMemberships()
      .then((rows) => {
        if (!cancelled) setMemberCount(rows.length);
      })
      .catch(() => {
        if (!cancelled) setMemberCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTenant?.id]);

  // Project status rollup — fast count of how the portfolio is laid out.
  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-5xl p-8">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wider text-accent-400">
            {preset.label} workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">
            {activeTenant?.name ?? preset.headline}
          </h1>
          <p className="mt-1 text-sm text-ink-400">{preset.description}</p>
        </header>

        {/* Tenant-level KPI tiles — portfolio shape, NOT card data.
         *  Card counts belong to projects; tenant scope sees the
         *  rollup. */}
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile
            label="Projects"
            value={projects.length}
            hint={
              projects.length === 0
                ? "create one to get started"
                : `${byStatus.released ?? 0} released · ${byStatus.production ?? 0} in production`
            }
            tone="violet"
          />
          <KpiTile
            label="Members"
            value={memberCount ?? "—"}
            hint="people in this workspace"
            tone="emerald"
          />
          <KpiTile
            label="Tenant type"
            value={preset.label}
            hint="changes in Settings"
            tone="amber"
          />
          <KpiTile
            label="Plan"
            value="—"
            hint="see Billing section"
            tone="indigo"
          />
        </section>

        {/* Project portfolio — the centerpiece of the tenant view.
         *  Click a tile to jump to the project subdomain (which then
         *  enforces ProjectMembership at the API). */}
        <section className="mb-6">
          <Panel
            title="Project portfolio"
            cta="Manage projects →"
            onCta={() => setView("projects")}
          >
            {projects.length === 0 ? (
              <div className="rounded border border-dashed border-ink-700 p-6 text-center">
                <p className="text-xs text-ink-300">No projects yet.</p>
                <p className="mt-1 text-[11px] text-ink-500">
                  Spin up your first project — the design tools live inside it.
                </p>
                <button
                  type="button"
                  onClick={() => setView("projects")}
                  className="mt-3 rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs text-accent-300 hover:bg-accent-500/25"
                >
                  + New project
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {projects.slice(0, 6).map((p) => (
                  <li
                    key={p.id}
                    className="rounded border border-ink-800 bg-ink-900 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink-100">
                        {p.name}
                      </p>
                      <span className="rounded border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-400">
                        {p.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-ink-500">
                      {p.slug} · {p.version}
                    </p>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">
                        {p.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        {/* Tenant-management shortcuts — the things a tenant admin
         *  actually does: invite members, configure brand, install
         *  plugins, manage billing. The capability matrix in action. */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ShortcutTile
            title="Members"
            description="Invite teammates and set their tenant role. Project access is added separately."
            cta="Manage in Settings"
            onClick={() => setView("settings")}
          />
          <ShortcutTile
            title="Plugins"
            description="Browse the marketplace and install plugins for your projects."
            cta="Open Marketplace"
            onClick={() => setView("marketplace")}
          />
          <ShortcutTile
            title="Public site"
            description="Your tenant's CMS — landing page, login styling, public card gallery."
            cta="Open CMS"
            onClick={() => setView("cms")}
            accent
          />
        </section>

        {/* Tenant-type suggestions still useful here — they orient
         *  the admin to what their archetype usually does next. */}
        <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {preset.suggestions.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setView(s.target)}
              className="rounded-lg border border-ink-800 bg-ink-900 p-3 text-left transition-colors hover:border-accent-500/40 hover:bg-ink-800/40"
            >
              <p className="text-[10px] uppercase tracking-wider text-accent-400">
                Suggested
              </p>
              <p className="mt-1 text-sm font-medium text-ink-100">{s.title}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">{s.body}</p>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Shared dashboard primitives                                            */
/* ---------------------------------------------------------------------- */

/**
 * KPI tile — wider than StatCard, with a colored top stripe to mark
 * which level/scope the metric belongs to. Tone maps to a tailwind
 * accent color so platform metrics look distinct from tenant ones.
 */
function KpiTile({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "ink" | "indigo" | "emerald" | "amber" | "violet";
}) {
  const stripe = {
    ink: "bg-ink-700",
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    violet: "bg-violet-500",
  }[tone];
  return (
    <div className="overflow-hidden rounded-lg border border-ink-800 bg-ink-900">
      <div className={`h-1 ${stripe}`} />
      <div className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
        <p className="mt-1 truncate text-2xl font-semibold text-ink-50">
          {value}
        </p>
        {hint && (
          <p className="mt-1 truncate text-[10px] text-ink-500">{hint}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Card-style panel with a title bar and an optional CTA link in the
 * top-right. Used for the "Recent tenants" / "Active announcements" /
 * "Project portfolio" sections so they share a visual rhythm.
 */
function Panel({
  title,
  cta,
  onCta,
  children,
}: {
  title: string;
  cta?: string;
  onCta?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-300">
          {title}
        </h2>
        {cta && onCta && (
          <button
            type="button"
            onClick={onCta}
            className="text-[11px] font-medium text-accent-300 hover:text-accent-200"
          >
            {cta}
          </button>
        )}
      </header>
      {children}
    </div>
  );
}
