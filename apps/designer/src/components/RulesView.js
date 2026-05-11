import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
/**
 * Rules view — currently a glossary of keywords (spec sec 25).
 *
 * Future iterations of this view will tab in:
 *   • Abilities (sec 24) — node-graph editor
 *   • Turn structure (sec 23) — phase order + priority windows
 *   • Rulebook (PDF / web export of the formal rules)
 *
 * For v0 we ship the keyword glossary because keywords are the lowest-cost,
 * highest-utility primitive of a TCG rules system: every card references
 * them, every player needs the reminder text, and they're cheap to model.
 */
const CATEGORY_OPTIONS = [
    "general",
    "evergreen",
    "deciduous",
    "set-specific",
    "ability_word",
];
const STATUS_OPTIONS = ["draft", "approved", "deprecated"];
export function RulesView() {
    const project = useDesigner(selectActiveProject);
    const [keywords, setKeywords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null);
    const [creating, setCreating] = useState(false);
    const [query, setQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const refresh = useCallback(async () => {
        if (!project) {
            setKeywords([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setKeywords(await api.listKeywords({ projectId: project.id }));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "load failed");
        }
        finally {
            setLoading(false);
        }
    }, [project]);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return keywords.filter((k) => {
            if (categoryFilter !== "all" && k.category !== categoryFilter)
                return false;
            if (!q)
                return true;
            return (k.name.toLowerCase().includes(q) ||
                k.slug.toLowerCase().includes(q) ||
                k.reminderText.toLowerCase().includes(q) ||
                k.rulesDefinition.toLowerCase().includes(q));
        });
    }, [keywords, query, categoryFilter]);
    // Group filtered list by category so the glossary scans well.
    const grouped = useMemo(() => {
        const out = new Map();
        for (const k of filtered) {
            const list = out.get(k.category) ?? [];
            list.push(k);
            out.set(k.category, list);
        }
        return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [filtered]);
    if (!project) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to see its rules glossary." }) }));
    }
    return (_jsxs("div", { className: "overflow-y-auto bg-ink-950", children: [_jsxs("div", { className: "mx-auto max-w-5xl p-6", children: [_jsxs("header", { className: "mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Rules \u00B7 Keywords" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [keywords.length, " keyword", keywords.length === 1 ? "" : "s", " \u00B7 the reusable rules vocabulary cards reference. Abilities + turn structure land later."] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search\u2026", className: "h-8 w-44 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 placeholder:text-ink-500" }), _jsxs("select", { value: categoryFilter, onChange: (e) => setCategoryFilter(e.target.value), className: "h-8 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100", children: [_jsx("option", { value: "all", children: "All categories" }), CATEGORY_OPTIONS.map((c) => (_jsx("option", { value: c, children: c }, c)))] }), _jsx("button", { type: "button", onClick: () => setCreating(true), className: "h-8 rounded border border-accent-500/40 bg-accent-500/15 px-3 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25", children: "+ New keyword" })] })] }), error && (_jsx("div", { className: "mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), loading && keywords.length === 0 ? (_jsx("p", { className: "py-10 text-center text-sm text-ink-500", children: "Loading\u2026" })) : filtered.length === 0 ? (_jsx(EmptyState, { hasAny: keywords.length > 0, onCreate: () => setCreating(true) })) : (_jsx("div", { className: "space-y-6", children: grouped.map(([cat, list]) => (_jsxs("section", { children: [_jsxs("h2", { className: "mb-2 text-[11px] uppercase tracking-wider text-ink-400", children: [cat, " ", _jsxs("span", { className: "text-ink-600", children: ["\u00B7 ", list.length] })] }), _jsx("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3", children: list.map((k) => (_jsx(KeywordTile, { kw: k, onEdit: () => setEditing(k) }, k.id))) })] }, cat))) }))] }), _jsx(KeywordEditor, { keyword: editing, open: editing !== null, projectId: project.id, onClose: () => setEditing(null), onSaved: (saved) => {
                    setKeywords((prev) => prev.map((k) => (k.id === saved.id ? saved : k)));
                }, onDeleted: (id) => {
                    setKeywords((prev) => prev.filter((k) => k.id !== id));
                } }), _jsx(KeywordEditor, { keyword: null, open: creating, projectId: project.id, onClose: () => setCreating(false), onSaved: (saved) => {
                    setKeywords((prev) => [saved, ...prev]);
                }, onDeleted: () => undefined })] }));
}
function EmptyState({ hasAny, onCreate }) {
    return (_jsxs("div", { className: "flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-700 p-10 text-center", children: [_jsx("p", { className: "text-sm text-ink-300", children: hasAny ? "No keywords match the current filters." : "No keywords yet." }), _jsx("p", { className: "max-w-md text-[11px] text-ink-500", children: "Keywords are the reusable rules terms that cards reference \u2014 Swift, Ward, Lifebind, Steadfast. Define them once, reference them from any card." }), _jsx("button", { type: "button", onClick: onCreate, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25", children: "+ Define a keyword" })] }));
}
function KeywordTile({ kw, onEdit }) {
    const accent = kw.color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(kw.color) ? kw.color : "#d4a24c";
    return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: onEdit, className: "flex h-full w-full flex-col gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3 text-left transition-colors hover:border-accent-500/40", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("h3", { className: "truncate text-sm font-semibold", style: { color: accent }, children: [kw.name, kw.parametersJson.length > 0 && (_jsx("span", { className: "ml-1 text-ink-400", children: kw.parametersJson.map((p) => p.name).join(" / ") }))] }), _jsx("p", { className: "font-mono text-[10px] text-ink-500", children: kw.slug })] }), _jsx(StatusPill, { status: kw.status })] }), kw.reminderText && (_jsx("p", { className: "line-clamp-3 text-[12px] italic leading-snug text-ink-300", children: kw.reminderText })), kw.rulesDefinition && (_jsx("p", { className: "mt-auto line-clamp-2 border-t border-ink-800 pt-2 text-[10px] text-ink-500", children: kw.rulesDefinition }))] }) }));
}
function StatusPill({ status }) {
    const map = {
        draft: "border-ink-700 bg-ink-800 text-ink-400",
        approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        deprecated: "border-ink-700 bg-ink-800 text-ink-600",
    };
    return (_jsx("span", { className: `shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${map[status] ?? map.draft}`, children: status }));
}
function emptyForm() {
    return {
        name: "",
        slug: "",
        reminderText: "",
        rulesDefinition: "",
        category: "general",
        parameters: [],
        color: "",
        status: "draft",
    };
}
function fromKeyword(k) {
    return {
        name: k.name,
        slug: k.slug,
        reminderText: k.reminderText,
        rulesDefinition: k.rulesDefinition,
        category: k.category,
        parameters: k.parametersJson ?? [],
        color: k.color ?? "",
        status: k.status,
    };
}
function autoSlug(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
}
function KeywordEditor({ keyword, open, projectId, onClose, onSaved, onDeleted, }) {
    const [form, setForm] = useState(emptyForm);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!open)
            return;
        setForm(keyword ? fromKeyword(keyword) : emptyForm());
        setError(null);
    }, [open, keyword]);
    if (!open)
        return null;
    const isEdit = keyword !== null;
    function set(key, value) {
        setForm((f) => ({ ...f, [key]: value }));
    }
    function addParam() {
        setForm((f) => ({
            ...f,
            parameters: [...f.parameters, { name: "n", type: "number", min: 0 }],
        }));
    }
    function removeParam(i) {
        setForm((f) => ({
            ...f,
            parameters: f.parameters.filter((_, idx) => idx !== i),
        }));
    }
    function patchParam(i, patch) {
        setForm((f) => ({
            ...f,
            parameters: f.parameters.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
        }));
    }
    async function save() {
        setBusy(true);
        setError(null);
        try {
            const payload = {
                name: form.name.trim(),
                slug: (form.slug.trim() || autoSlug(form.name)) || "keyword",
                reminderText: form.reminderText,
                rulesDefinition: form.rulesDefinition,
                category: form.category,
                parametersJson: form.parameters,
                color: form.color.trim() || null,
                status: form.status,
            };
            let saved;
            if (isEdit) {
                saved = await api.updateKeyword(keyword.id, payload);
            }
            else {
                saved = await api.createKeyword({ projectId, ...payload });
            }
            onSaved(saved);
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
        finally {
            setBusy(false);
        }
    }
    async function remove() {
        if (!keyword)
            return;
        if (!confirm(`Delete keyword "${keyword.name}"?`))
            return;
        setBusy(true);
        setError(null);
        try {
            await api.deleteKeyword(keyword.id);
            onDeleted(keyword.id);
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "delete failed");
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": isEdit ? "Edit keyword" : "New keyword", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !busy)
                onClose();
        }, children: _jsxs("div", { className: "flex h-[90vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-start justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-50", children: isEdit ? "Edit keyword" : "New keyword" }), _jsx("p", { className: "text-[11px] text-ink-500", children: isEdit
                                        ? "Cards referencing this keyword update everywhere."
                                        : "Define a reusable rules term for this project." })] }), _jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4 space-y-3", children: [_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Name", children: _jsx("input", { type: "text", value: form.name, onChange: (e) => {
                                            set("name", e.target.value);
                                            if (!form.slug)
                                                set("slug", autoSlug(e.target.value));
                                        }, placeholder: "Swift", className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsx(Field, { label: "Slug", children: _jsx("input", { type: "text", value: form.slug, onChange: (e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-")), placeholder: "swift", className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100" }) })] }), _jsx(Field, { label: "Reminder text", hint: "Short italicized line shown on cards.", children: _jsx("textarea", { value: form.reminderText, rows: 2, onChange: (e) => set("reminderText", e.target.value), placeholder: "(This Character can attack the turn it enters the Stage.)", className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs italic text-ink-100" }) }), _jsx(Field, { label: "Rules definition", hint: "Long-form formal definition for the rulebook.", children: _jsx("textarea", { value: form.rulesDefinition, rows: 4, onChange: (e) => set("rulesDefinition", e.target.value), placeholder: "Swift is a static ability. A Character with Swift may attack on the turn it enters the Stage\u2026", className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsxs("div", { className: "grid grid-cols-3 gap-3", children: [_jsx(Field, { label: "Category", children: _jsx("select", { value: form.category, onChange: (e) => set("category", e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: CATEGORY_OPTIONS.map((c) => (_jsx("option", { value: c, children: c }, c))) }) }), _jsx(Field, { label: "Status", children: _jsx("select", { value: form.status, onChange: (e) => set("status", e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: STATUS_OPTIONS.map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "Color", children: _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "color", value: /^#([0-9a-fA-F]{6})$/.test(form.color) ? form.color : "#d4a24c", onChange: (e) => set("color", e.target.value), className: "h-7 w-9 cursor-pointer rounded border border-ink-700 bg-ink-900 p-0.5" }), _jsx("input", { type: "text", value: form.color, onChange: (e) => set("color", e.target.value), placeholder: "(default)", className: "block flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100" })] }) })] }), _jsxs("fieldset", { className: "space-y-2 rounded border border-ink-800 bg-ink-900/40 p-3", children: [_jsx("legend", { className: "px-1 text-[10px] uppercase tracking-wider text-ink-400", children: "Parameters" }), _jsxs("p", { className: "text-[11px] text-ink-500", children: ["Add parameters for keywords like ", _jsx("code", { children: "Ward N" }), " or ", _jsx("code", { children: "Echo X" }), "."] }), form.parameters.length === 0 && (_jsx("p", { className: "py-1 text-[11px] text-ink-600", children: "No parameters \u2014 nullary keyword." })), _jsx("ul", { className: "space-y-1", children: form.parameters.map((p, i) => (_jsxs("li", { className: "grid grid-cols-[80px_100px_80px_80px_auto] items-center gap-1.5", children: [_jsx("input", { type: "text", value: p.name, onChange: (e) => patchParam(i, { name: e.target.value }), placeholder: "N", className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-ink-100" }), _jsxs("select", { value: p.type, onChange: (e) => patchParam(i, { type: e.target.value }), className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100", children: [_jsx("option", { value: "number", children: "number" }), _jsx("option", { value: "text", children: "text" })] }), _jsx("input", { type: "number", value: p.min ?? "", onChange: (e) => patchParam(i, { min: e.target.value === "" ? undefined : Number(e.target.value) }), placeholder: "min", disabled: p.type !== "number", className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100 disabled:opacity-30" }), _jsx("input", { type: "number", value: p.max ?? "", onChange: (e) => patchParam(i, { max: e.target.value === "" ? undefined : Number(e.target.value) }), placeholder: "max", disabled: p.type !== "number", className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100 disabled:opacity-30" }), _jsx("button", { type: "button", onClick: () => removeParam(i), className: "inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-danger-500/20 hover:text-danger-500", title: "Remove", children: "\u00D7" })] }, i))) }), _jsx("button", { type: "button", onClick: addParam, className: "rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700", children: "+ Add parameter" })] })] }), error && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: error })), _jsxs("footer", { className: "flex items-center justify-between gap-2 border-t border-ink-700 px-4 py-3", children: [_jsx("div", { children: isEdit && (_jsx("button", { type: "button", onClick: remove, disabled: busy, className: "rounded border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20", children: "Delete" })) }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "button", onClick: save, disabled: busy || !form.name.trim(), className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: busy ? "Saving…" : isEdit ? "Save" : "Create" })] })] })] }) }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
