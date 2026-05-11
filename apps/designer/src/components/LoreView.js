import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import { assetBlobUrl } from "@/lib/api";
const LORE_KINDS = [
    { value: "world", label: "Worlds" },
    { value: "region", label: "Regions" },
    { value: "character", label: "Characters" },
    { value: "artifact", label: "Artifacts" },
    { value: "event", label: "Events" },
    { value: "timeline", label: "Timeline" },
    { value: "chapter", label: "Story chapters" },
    { value: "custom", label: "Other" },
];
/**
 * Lore view (sec 29).
 *
 * Project-scoped worldbuilding records — characters, regions, events,
 * artifacts, story chapters. Layout mirrors the FactionsView pattern:
 *   • Left aside  — kind tabs + entry list within the active kind.
 *   • Right main — detail panel with name / summary / body (markdown) /
 *                  cover asset id / faction / set / status.
 *
 * Visibility (sec 14.12) controls whether an entry surfaces on the
 * public lore portal. Authors stage drafts privately, then flip to
 * `public` when the story moment is canon.
 */
export function LoreView() {
    const project = useDesigner(selectActiveProject);
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [activeKind, setActiveKind] = useState("character");
    const [selectedId, setSelectedId] = useState(null);
    const [creating, setCreating] = useState(false);
    const refresh = useCallback(async () => {
        if (!project) {
            setEntries([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setEntries(await api.listLore({ projectId: project.id }));
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
    const filtered = useMemo(() => entries.filter((e) => e.kind === activeKind), [entries, activeKind]);
    const selected = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);
    // Tab counts come from the unfiltered list — gives the user a quick
    // sense of what they have without flipping through tabs.
    const counts = useMemo(() => {
        const m = new Map();
        for (const e of entries)
            m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
        return m;
    }, [entries]);
    async function handleCreate(input) {
        if (!project)
            return;
        setBusy(true);
        setError(null);
        try {
            const created = await api.createLore({ projectId: project.id, ...input });
            setEntries((prev) => [...prev, created]);
            setActiveKind(created.kind);
            setSelectedId(created.id);
            setCreating(false);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "create failed");
        }
        finally {
            setBusy(false);
        }
    }
    async function handlePatch(id, patch) {
        setBusy(true);
        setError(null);
        try {
            const updated = await api.updateLore(id, patch);
            setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
        finally {
            setBusy(false);
        }
    }
    async function handleDelete(id) {
        if (!confirm("Delete this lore entry? Card references survive."))
            return;
        try {
            await api.deleteLore(id);
            setEntries((prev) => prev.filter((e) => e.id !== id));
            if (selectedId === id)
                setSelectedId(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "delete failed");
        }
    }
    if (!project) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to manage its lore." }) }));
    }
    return (_jsxs("div", { className: "grid grid-cols-[300px_1fr] overflow-hidden", children: [_jsxs("aside", { className: "flex flex-col overflow-hidden border-r border-ink-700 bg-ink-900", children: [_jsxs("header", { className: "border-b border-ink-700 px-3 py-3", children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-base font-semibold text-ink-50", children: "Lore" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [entries.length, " entr", entries.length === 1 ? "y" : "ies"] }), _jsx("div", { className: "mt-3", children: _jsx("button", { type: "button", onClick: () => {
                                        setSelectedId(null);
                                        setCreating(true);
                                    }, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25", children: "+ New entry" }) })] }), _jsx("nav", { className: "border-b border-ink-700 px-2 py-2", children: _jsx("ul", { className: "flex flex-wrap gap-1", children: LORE_KINDS.map((k) => {
                                const n = counts.get(k.value) ?? 0;
                                const active = activeKind === k.value;
                                return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setActiveKind(k.value), className: [
                                            "rounded border px-2 py-0.5 text-[11px]",
                                            active
                                                ? "border-accent-500/40 bg-accent-500/15 text-accent-200"
                                                : "border-ink-800 bg-ink-900 text-ink-300 hover:bg-ink-800",
                                        ].join(" "), children: [k.label, _jsx("span", { className: "ml-1 font-mono text-[10px] text-ink-500", children: n })] }) }, k.value));
                            }) }) }), _jsx("ul", { className: "flex-1 overflow-y-auto py-1", children: loading ? (_jsx("li", { className: "px-3 py-4 text-center text-xs text-ink-500", children: "Loading\u2026" })) : filtered.length === 0 ? (_jsxs("li", { className: "px-3 py-6 text-center text-xs text-ink-500", children: ["No ", LORE_KINDS.find((k) => k.value === activeKind)?.label.toLowerCase() ?? "", " yet."] })) : (filtered.map((e) => (_jsxs("li", { onClick: () => {
                                setSelectedId(e.id);
                                setCreating(false);
                            }, className: [
                                "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                                selectedId === e.id
                                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                                    : "text-ink-100 hover:bg-ink-800",
                            ].join(" "), children: [e.coverAssetId ? (_jsx("span", { className: "inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-800", children: _jsx("img", { src: assetBlobUrl(e.coverAssetId), alt: "", className: "max-h-full max-w-full object-cover" }) })) : (_jsx("span", { className: "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-ink-800 text-[10px] text-ink-500", children: e.kind[0]?.toUpperCase() })), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate font-medium", children: e.name }), _jsx("span", { className: "block truncate font-mono text-[10px] text-ink-500", children: e.slug })] }), _jsx(VisibilityPill, { v: e.visibility })] }, e.id)))) })] }), _jsxs("main", { className: "overflow-y-auto bg-ink-950 p-6", children: [error && (_jsx("div", { className: "mb-4 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), creating ? (_jsx(LoreCreateForm, { defaultKind: activeKind, onCancel: () => setCreating(false), onCreate: handleCreate, busy: busy })) : selected ? (_jsx(LoreDetail, { entry: selected, onPatch: (patch) => handlePatch(selected.id, patch), onDelete: () => handleDelete(selected.id), busy: busy })) : (_jsxs("div", { className: "rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500", children: ["Pick an entry on the left, or click ", _jsx("span", { className: "text-ink-300", children: "New entry" }), "."] }))] })] }));
}
function VisibilityPill({ v }) {
    const map = {
        private: { label: "Private", cls: "bg-ink-800 text-ink-400" },
        internal: { label: "Internal", cls: "bg-ink-800 text-ink-300" },
        public_after_release: { label: "After release", cls: "bg-amber-500/15 text-amber-300" },
        public: { label: "Public", cls: "bg-emerald-500/15 text-emerald-300" },
    };
    const m = map[v] ?? map.private;
    return (_jsx("span", { className: [
            "shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            m.cls,
        ].join(" "), children: m.label }));
}
function LoreCreateForm({ defaultKind, onCancel, onCreate, busy, }) {
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [kind, setKind] = useState(defaultKind);
    const [summary, setSummary] = useState("");
    const [touchedSlug, setTouchedSlug] = useState(false);
    function onName(v) {
        setName(v);
        if (!touchedSlug)
            setSlug(slugify(v));
    }
    function submit(e) {
        e.preventDefault();
        if (!name || !slug)
            return;
        onCreate({ name, slug, kind, summary });
    }
    return (_jsxs("form", { onSubmit: submit, className: "max-w-xl space-y-4", children: [_jsxs("header", { children: [_jsx("h2", { className: "text-base font-semibold text-ink-50", children: "New lore entry" }), _jsx("p", { className: "mt-1 text-xs text-ink-400", children: "Pick a kind, name, and slug. Body, cover art, faction, and visibility can be added afterward." })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Kind", children: _jsx("select", { value: kind, onChange: (e) => setKind(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: LORE_KINDS.map((k) => (_jsx("option", { value: k.value, children: k.label }, k.value))) }) }), _jsx(Field, { label: "Name", children: _jsx(Input, { value: name, onChange: onName }) })] }), _jsx(Field, { label: "Slug", hint: "URL-safe identifier; unique inside the project.", children: _jsx(Input, { value: slug, onChange: (v) => {
                        setTouchedSlug(true);
                        setSlug(v);
                    } }) }), _jsx(Field, { label: "Summary", hint: "Short blurb for tile previews.", children: _jsx("textarea", { value: summary, onChange: (e) => setSummary(e.target.value), rows: 3, className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100" }) }), _jsxs("div", { className: "flex items-center gap-2 pt-2", children: [_jsx("button", { type: "button", onClick: onCancel, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name || !slug, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "Creating…" : "Create" })] })] }));
}
function LoreDetail({ entry, onPatch, onDelete, busy, }) {
    const [draft, setDraft] = useState(entry);
    useEffect(() => setDraft(entry), [entry]);
    function commit(key, value) {
        if (entry[key] === value)
            return;
        setDraft({ ...draft, [key]: value });
        onPatch({ [key]: value });
    }
    return (_jsxs("div", { className: "max-w-3xl space-y-4", children: [_jsxs("header", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[11px] uppercase tracking-wider text-ink-500", children: entry.kind }), _jsx("h2", { className: "mt-0.5 text-base font-semibold text-ink-50", children: entry.name }), _jsx("p", { className: "mt-1 font-mono text-[11px] text-ink-500", children: entry.slug })] }), _jsx("button", { type: "button", onClick: onDelete, disabled: busy, className: "rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20 disabled:opacity-40", children: "Delete" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Name", children: _jsx(Input, { value: draft.name, onChange: (v) => setDraft({ ...draft, name: v }), onBlur: () => commit("name", draft.name) }) }), _jsx(Field, { label: "Kind", children: _jsx("select", { value: draft.kind, onChange: (e) => commit("kind", e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: LORE_KINDS.map((k) => (_jsx("option", { value: k.value, children: k.label }, k.value))) }) }), _jsx(Field, { label: "Status", children: _jsx("select", { value: draft.status, onChange: (e) => commit("status", e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["draft", "review", "approved", "released", "archived"].map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "Visibility", children: _jsx("select", { value: draft.visibility, onChange: (e) => commit("visibility", e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["private", "internal", "public_after_release", "public"].map((v) => (_jsx("option", { value: v, children: v.replace(/_/g, " ") }, v))) }) }), _jsx(Field, { label: "Cover asset id", hint: "Asset id from the project's library.", children: _jsx(Input, { value: draft.coverAssetId ?? "", onChange: (v) => setDraft({ ...draft, coverAssetId: v.trim() || null }), onBlur: () => commit("coverAssetId", draft.coverAssetId) }) }), _jsx(Field, { label: "Faction id", hint: "Optional \u2014 links character \u2192 faction etc.", children: _jsx(Input, { value: draft.factionId ?? "", onChange: (v) => setDraft({ ...draft, factionId: v.trim() || null }), onBlur: () => commit("factionId", draft.factionId) }) }), _jsx(Field, { label: "Set id", hint: "Optional \u2014 for set-canonical events.", children: _jsx(Input, { value: draft.setId ?? "", onChange: (v) => setDraft({ ...draft, setId: v.trim() || null }), onBlur: () => commit("setId", draft.setId) }) }), _jsx(Field, { label: "Sort order", children: _jsx("input", { type: "number", value: draft.sortOrder, onChange: (e) => {
                                const n = Number(e.target.value);
                                setDraft({ ...draft, sortOrder: Number.isFinite(n) ? n : draft.sortOrder });
                            }, onBlur: () => commit("sortOrder", draft.sortOrder), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100" }) })] }), _jsx(Field, { label: "Summary", hint: "Tile preview text \u2014 keep short.", children: _jsx("textarea", { value: draft.summary, onChange: (e) => setDraft({ ...draft, summary: e.target.value }), onBlur: () => commit("summary", draft.summary), rows: 2, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100" }) }), _jsx(Field, { label: "Body", hint: "Markdown. Renders on the public lore page.", children: _jsx("textarea", { value: draft.body, onChange: (e) => setDraft({ ...draft, body: e.target.value }), onBlur: () => commit("body", draft.body), rows: 14, className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs leading-relaxed text-ink-100" }) })] }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function Input({ value, onChange, onBlur, }) {
    return (_jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), onBlur: onBlur, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }));
}
function slugify(input) {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
}
