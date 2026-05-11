import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { useDesigner } from "@/store/designerStore";
import { summarize, validateTemplate, } from "@/lib/validate";
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
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("header", { className: "flex items-baseline justify-between border-b border-ink-700 px-3 py-2", children: [_jsx("h2", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: "Validation" }), _jsx(Counters, { summary: summary })] }), _jsx("ul", { className: "flex-1 overflow-y-auto py-1", children: issues.length === 0 ? (_jsx("li", { className: "px-3 py-6 text-center text-xs text-ink-400", children: "No issues. Nice." })) : (issues.map((issue) => (_jsx(IssueRow, { issue: issue, isSelected: issue.layerId !== null && issue.layerId === primaryId, onClick: () => issue.layerId && selectLayer(issue.layerId) }, issue.id)))) })] }));
}
function IssueRow({ issue, isSelected, onClick, }) {
    const clickable = issue.layerId !== null;
    return (_jsxs("li", { onClick: clickable ? onClick : undefined, title: issue.rule, className: [
            "flex gap-2 border-l-2 px-3 py-1.5 text-xs",
            clickable ? "cursor-pointer hover:bg-ink-800" : "",
            isSelected ? "bg-ink-800" : "",
            SEVERITY_BORDER[issue.severity],
        ].join(" "), children: [_jsx(SeverityDot, { severity: issue.severity }), _jsx("span", { className: "flex-1 leading-snug text-ink-100", children: issue.message })] }));
}
function Counters({ summary }) {
    return (_jsxs("div", { className: "flex items-center gap-1 text-[10px] uppercase tracking-wider", children: [_jsx(Counter, { label: "err", count: summary.errors, severity: "error" }), _jsx(Counter, { label: "warn", count: summary.warnings, severity: "warning" }), _jsx(Counter, { label: "info", count: summary.infos, severity: "info" })] }));
}
function Counter({ label, count, severity, }) {
    if (count === 0)
        return _jsxs("span", { className: "text-ink-600", children: [label, " 0"] });
    return (_jsxs("span", { className: SEVERITY_TEXT[severity], children: [label, " ", count] }));
}
function SeverityDot({ severity }) {
    return (_jsx("span", { "aria-label": severity, className: [
            "mt-1 inline-block h-2 w-2 shrink-0 rounded-full",
            SEVERITY_DOT[severity],
        ].join(" ") }));
}
const SEVERITY_DOT = {
    error: "bg-danger-500",
    warning: "bg-amber-400",
    info: "bg-sky-400",
};
const SEVERITY_BORDER = {
    error: "border-l-danger-500",
    warning: "border-l-amber-400",
    info: "border-l-sky-400",
};
const SEVERITY_TEXT = {
    error: "text-danger-500",
    warning: "text-amber-300",
    info: "text-sky-300",
};
