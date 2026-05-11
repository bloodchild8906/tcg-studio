import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import {
  validateProject,
  summarizeIssues,
  type Issue,
  type IssueSeverity,
  type IssueCategory,
  type ProjectValidationBundle,
} from "@/lib/projectValidation";

/**
 * Project-wide validation overview.
 *
 * Loads every resource the validator needs, runs `validateProject`,
 * and renders the result with severity + category chips for filtering.
 * Each issue links back to its owning resource so authors can jump
 * straight to "open the broken card / deck / set".
 */
export function ValidationOverviewView() {
  const project = useDesigner(selectActiveProject);
  const setView = useDesigner((s) => s.setView);
  const [bundle, setBundle] = useState<ProjectValidationBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | "all">("all");

  const refresh = useCallback(async () => {
    if (!project) {
      setBundle(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cards, cardTypes, sets, decks, factions, keywords, abilities, lore] =
        await Promise.all([
          api.listCards({ projectId: project.id }),
          api.listCardTypes(project.id),
          api.listSets({ projectId: project.id }),
          api.listDecks({ projectId: project.id }).catch(() => []),
          api.listFactions({ projectId: project.id }).catch(() => []),
          api.listKeywords({ projectId: project.id }).catch(() => []),
          api.listAbilities({ projectId: project.id }).catch(() => []),
          api.listLore({ projectId: project.id }).catch(() => []),
        ]);

      // Hydrate decks with embedded card lists so deck-card validation
      // has slot data. We only fetch decks that have at least one card
      // (count > 0) — empty decks have nothing to validate.
      const hydratedDecks = await Promise.all(
        decks
          .filter((d) => (d.cardCount ?? 0) > 0)
          .map((d) => api.getDeck(d.id).catch(() => d)),
      );

      setBundle({
        cards,
        cardTypes,
        sets,
        decks: hydratedDecks,
        factions,
        keywords,
        abilities,
        lore,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const issues = useMemo(() => (bundle ? validateProject(bundle) : []), [bundle]);
  const summary = useMemo(() => summarizeIssues(issues), [issues]);

  const visible = useMemo(() => {
    return issues.filter((i) => {
      if (severityFilter !== "all" && i.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
      return true;
    });
  }, [issues, severityFilter, categoryFilter]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to validate.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              Project: {project.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-50">Validation</h1>
            <p className="mt-1 text-xs text-ink-400">
              Cross-resource checks — broken references, duplicate slugs, schema gaps,
              orphaned taxonomy.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        </header>

        {error && (
          <div className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        {/* Summary chips */}
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
          <SummaryChip
            label="All"
            count={summary.total}
            active={severityFilter === "all"}
            onClick={() => setSeverityFilter("all")}
          />
          <SummaryChip
            label="Errors"
            count={summary.bySeverity.error}
            tone="danger"
            active={severityFilter === "error"}
            onClick={() => setSeverityFilter("error")}
          />
          <SummaryChip
            label="Warnings"
            count={summary.bySeverity.warning}
            tone="amber"
            active={severityFilter === "warning"}
            onClick={() => setSeverityFilter("warning")}
          />
          <SummaryChip
            label="Info"
            count={summary.bySeverity.info}
            tone="neutral"
            active={severityFilter === "info"}
            onClick={() => setSeverityFilter("info")}
          />
          <span className="mx-2 h-4 w-px bg-ink-700" />
          {(
            [
              "all",
              "identity",
              "reference",
              "duplication",
              "schema",
              "orphans",
              "consistency",
            ] as const
          ).map((cat) => {
            const n = cat === "all" ? summary.total : summary.byCategory[cat];
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={[
                  "rounded border px-2 py-0.5 text-[11px]",
                  active
                    ? "border-accent-500/40 bg-accent-500/15 text-accent-200"
                    : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                {cat}
                <span className="ml-1 font-mono text-[10px] text-ink-500">{n}</span>
              </button>
            );
          })}
        </section>

        {/* Issue list */}
        {loading && !bundle ? (
          <p className="py-10 text-center text-sm text-ink-500">Scanning…</p>
        ) : visible.length === 0 ? (
          <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-6 text-center text-sm text-emerald-300">
            {summary.total === 0 ? "No issues — project looks clean." : "No issues match the filters."}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onJump={() => navigateToEntity(issue, setView)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: "danger" | "amber" | "neutral";
  onClick: () => void;
}) {
  const toneCls =
    tone === "danger"
      ? "text-danger-500"
      : tone === "amber"
      ? "text-amber-300"
      : tone === "neutral"
      ? "text-ink-300"
      : "text-ink-100";
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded border px-2.5 py-1 text-xs",
        active
          ? "border-accent-500/40 bg-accent-500/15 text-accent-200"
          : "border-ink-700 bg-ink-900 hover:bg-ink-800",
      ].join(" ")}
    >
      <span className={toneCls}>{label}</span>
      <span className="ml-1 font-mono text-[11px] text-ink-400">{count}</span>
    </button>
  );
}

function IssueRow({
  issue,
  onJump,
}: {
  issue: Issue;
  onJump: () => void;
}) {
  const sev = issue.severity;
  const sevCls =
    sev === "error"
      ? "border-danger-500/40 bg-danger-500/10"
      : sev === "warning"
      ? "border-amber-500/30 bg-amber-500/10"
      : "border-ink-800 bg-ink-900/40";
  const sevLabel =
    sev === "error" ? "ERR" : sev === "warning" ? "WRN" : "INF";
  const sevBadgeCls =
    sev === "error"
      ? "bg-danger-500/30 text-danger-500"
      : sev === "warning"
      ? "bg-amber-500/20 text-amber-300"
      : "bg-ink-800 text-ink-400";
  return (
    <li
      className={["flex items-start gap-3 rounded border px-3 py-2", sevCls].join(" ")}
    >
      <span
        className={[
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider",
          sevBadgeCls,
        ].join(" ")}
      >
        {sevLabel}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-100">{issue.message}</p>
        {issue.detail && (
          <p className="mt-0.5 font-mono text-[10px] text-ink-500">{issue.detail}</p>
        )}
        {issue.entity && (
          <p className="mt-0.5 text-[10px] text-ink-500">
            <span className="rounded bg-ink-800 px-1 py-0.5 font-mono uppercase tracking-wider text-ink-400">
              {issue.entity.kind.replace("_", " ")}
            </span>{" "}
            <span className="text-ink-300">{issue.entity.name}</span>
          </p>
        )}
      </div>
      <span className="shrink-0 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
        {issue.category}
      </span>
      {issue.entity && (
        <button
          type="button"
          onClick={onJump}
          className="shrink-0 rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[11px] text-ink-100 hover:bg-ink-700"
        >
          Open ↗
        </button>
      )}
    </li>
  );
}

/**
 * Best-effort navigation from an issue back to the resource it
 * concerns. We can only flip top-level views (no per-record routing
 * in the current view model), so the user lands on the right grid /
 * list and can resume from there.
 */
function navigateToEntity(
  issue: Issue,
  setView: ReturnType<typeof useDesigner.getState>["setView"],
) {
  if (!issue.entity) return;
  switch (issue.entity.kind) {
    case "card":
      setView("cards");
      return;
    case "card_type":
      setView("card_types");
      return;
    case "set":
      setView("sets");
      return;
    case "deck":
      setView("decks");
      return;
    case "faction":
      setView("factions");
      return;
    case "keyword":
      setView("rules");
      return;
    case "ability":
      setView("abilities");
      return;
    case "lore":
      setView("lore");
      return;
  }
}
