import { useMemo } from "react";
import { useDesigner } from "@/store/designerStore";
import {
  summarize,
  validateTemplate,
  type IssueSeverity,
  type ValidationIssue,
} from "@/lib/validate";

/**
 * Validation panel — bottom half of the right column.
 *
 * Recomputes synchronously on every template change. The validator is pure
 * and the template tops out at ~50–100 layers in realistic projects, so
 * memoization keyed on the template reference is enough.
 *
 * Click an issue → selects its layer (so the user can jump to and fix it).
 */
export function ValidationPanel() {
  const template = useDesigner((s) => s.template);
  const selectedIds = useDesigner((s) => s.selectedLayerIds);
  const selectLayer = useDesigner((s) => s.selectLayer);
  const primaryId = selectedIds[0] ?? null;

  const issues = useMemo(() => validateTemplate(template), [template]);
  const summary = useMemo(() => summarize(issues), [issues]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-ink-700 px-3 py-2">
        <h2 className="text-[11px] uppercase tracking-wider text-ink-400">Validation</h2>
        <Counters summary={summary} />
      </header>
      <ul className="flex-1 overflow-y-auto py-1">
        {issues.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-ink-400">
            No issues. Nice.
          </li>
        ) : (
          issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              isSelected={issue.layerId !== null && issue.layerId === primaryId}
              onClick={() => issue.layerId && selectLayer(issue.layerId)}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function IssueRow({
  issue,
  isSelected,
  onClick,
}: {
  issue: ValidationIssue;
  isSelected: boolean;
  onClick: () => void;
}) {
  const clickable = issue.layerId !== null;
  return (
    <li
      onClick={clickable ? onClick : undefined}
      title={issue.rule}
      className={[
        "flex gap-2 border-l-2 px-3 py-1.5 text-xs",
        clickable ? "cursor-pointer hover:bg-ink-800" : "",
        isSelected ? "bg-ink-800" : "",
        SEVERITY_BORDER[issue.severity],
      ].join(" ")}
    >
      <SeverityDot severity={issue.severity} />
      <span className="flex-1 leading-snug text-ink-100">{issue.message}</span>
    </li>
  );
}

function Counters({ summary }: { summary: ReturnType<typeof summarize> }) {
  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider">
      <Counter label="err" count={summary.errors} severity="error" />
      <Counter label="warn" count={summary.warnings} severity="warning" />
      <Counter label="info" count={summary.infos} severity="info" />
    </div>
  );
}

function Counter({
  label,
  count,
  severity,
}: {
  label: string;
  count: number;
  severity: IssueSeverity;
}) {
  if (count === 0) return <span className="text-ink-600">{label} 0</span>;
  return (
    <span className={SEVERITY_TEXT[severity]}>
      {label} {count}
    </span>
  );
}

function SeverityDot({ severity }: { severity: IssueSeverity }) {
  return (
    <span
      aria-label={severity}
      className={[
        "mt-1 inline-block h-2 w-2 shrink-0 rounded-full",
        SEVERITY_DOT[severity],
      ].join(" ")}
    />
  );
}

const SEVERITY_DOT: Record<IssueSeverity, string> = {
  error: "bg-danger-500",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

const SEVERITY_BORDER: Record<IssueSeverity, string> = {
  error: "border-l-danger-500",
  warning: "border-l-amber-400",
  info: "border-l-sky-400",
};

const SEVERITY_TEXT: Record<IssueSeverity, string> = {
  error: "text-danger-500",
  warning: "text-amber-300",
  info: "text-sky-300",
};
