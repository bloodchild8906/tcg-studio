import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import { PackGeneratorModal } from "@/components/PackGeneratorModal";
import { BlockManagerModal } from "@/components/BlockManagerModal";
/**
 * Sets view — spec sec 27.
 *
 * Lists every set in the active project. Each tile shows code, status, card
 * count, release date, and inline action buttons. The "+ New set" tile opens
 * an inline form that POSTs and prepends the new set on success.
 *
 * Why a tenant-scoped state slice for sets isn't needed yet: the cards work
 * already filters cards by setId on demand (`api.listCards({ setId })`) and
 * the SetsView re-fetches its own list on mount. We can promote sets to a
 * top-level store slice when card editing wants to filter / pick a set.
 */
export function SetsView() {
    const project = useDesigner(selectActiveProject);
    const [sets, setSets] = useState([]);
    const [blocks, setBlocks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null);
    const [packing, setPacking] = useState(null);
    const [blockManagerOpen, setBlockManagerOpen] = useState(false);
    const refresh = useCallback(async () => {
        if (!project) {
            setSets([]);
            setBlocks([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            // Fetch blocks and sets in parallel — they're independent and the
            // sets header shows block totals so we want both before render.
            const [s, b] = await Promise.all([
                api.listSets({ projectId: project.id }),
                api.listBlocks({ projectId: project.id }),
            ]);
            setSets(s);
            setBlocks(b);
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
    // Group sets by block — null/undefined block lands in the "Unblocked"
    // bucket. Block order follows block.sortOrder; sets keep their list order.
    const grouped = useMemo(() => {
        const byBlock = new Map();
        for (const s of sets) {
            const key = s.blockId ?? "__none__";
            const arr = byBlock.get(key);
            if (arr)
                arr.push(s);
            else
                byBlock.set(key, [s]);
        }
        const sortedBlocks = [...blocks].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        return { byBlock, sortedBlocks };
    }, [sets, blocks]);
    if (!project) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to see its sets." }) }));
    }
    return (_jsxs("div", { className: "overflow-y-auto bg-ink-950", children: [_jsxs("div", { className: "mx-auto max-w-6xl p-6", children: [_jsxs("header", { className: "mb-5 flex items-end justify-between", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Sets" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [sets.length, " set", sets.length === 1 ? "" : "s", " \u00B7 ", blocks.length, " block", blocks.length === 1 ? "" : "s", " \u00B7 groups cards by release."] })] }), _jsx("button", { type: "button", onClick: () => setBlockManagerOpen(true), className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700", children: "Manage blocks" })] }), error && (_jsx("div", { className: "mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), loading && sets.length === 0 ? (_jsx("p", { className: "py-6 text-center text-sm text-ink-500", children: "Loading\u2026" })) : (_jsxs("div", { className: "space-y-6", children: [grouped.sortedBlocks.map((block) => (_jsx(SetGroupSection, { block: block, sets: grouped.byBlock.get(block.id) ?? [], onEdit: (s) => setEditing(s), onPack: (s) => setPacking(s), onDelete: async (s) => {
                                    if (!confirm(`Delete set "${s.name}" (${s.code})?\nCards in it will become set-less but won't be deleted.`))
                                        return;
                                    try {
                                        await api.deleteSet(s.id);
                                        await refresh();
                                    }
                                    catch (err) {
                                        setError(err instanceof Error ? err.message : "delete failed");
                                    }
                                } }, block.id))), _jsx(SetGroupSection, { block: null, sets: grouped.byBlock.get("__none__") ?? [], showNew: true, projectId: project.id, onCreated: refresh, onEdit: (s) => setEditing(s), onPack: (s) => setPacking(s), onDelete: async (s) => {
                                    if (!confirm(`Delete set "${s.name}" (${s.code})?\nCards in it will become set-less but won't be deleted.`))
                                        return;
                                    try {
                                        await api.deleteSet(s.id);
                                        await refresh();
                                    }
                                    catch (err) {
                                        setError(err instanceof Error ? err.message : "delete failed");
                                    }
                                } })] }))] }), _jsx(SetEditor, { set: editing, open: editing !== null, onClose: () => setEditing(null), onSaved: (updated) => {
                    setSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                } }), _jsx(PackGeneratorModal, { set: packing, open: packing !== null, onClose: () => setPacking(null), onSaved: (updated) => {
                    setSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                } }), _jsx(BlockManagerModal, { open: blockManagerOpen, projectId: project?.id ?? null, blocks: blocks, onClose: () => setBlockManagerOpen(false), onChanged: refresh })] }));
}
/**
 * One block's worth of sets, rendered as a labeled section. The
 * unblocked bucket is rendered with `block={null}` and includes the
 * "+ New set" tile + a header that just says "Unblocked".
 */
function SetGroupSection({ block, sets, showNew, projectId, onCreated, onEdit, onPack, onDelete, }) {
    // Skip empty unblocked sections unless we're showing the "+ New" tile.
    if (!block && sets.length === 0 && !showNew)
        return null;
    return (_jsxs("section", { children: [_jsxs("header", { className: "mb-2 flex items-baseline justify-between", children: [_jsxs("div", { className: "flex items-baseline gap-2", children: [block && (_jsx("span", { className: "inline-block h-3 w-3 rounded", style: { background: block.color }, "aria-hidden": "true" })), _jsx("h2", { className: "text-sm font-semibold text-ink-100", children: block ? block.name : "Unblocked" }), _jsxs("span", { className: "text-[11px] text-ink-500", children: [sets.length, " set", sets.length === 1 ? "" : "s"] })] }), block?.description && (_jsx("p", { className: "line-clamp-1 max-w-[40ch] text-[11px] text-ink-500", children: block.description }))] }), _jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3", children: [showNew && projectId && onCreated && (_jsx(NewSetTile, { projectId: projectId, onCreated: onCreated })), sets.map((s) => (_jsx(SetTile, { set: s, onEdit: () => onEdit(s), onPack: () => onPack(s), onDelete: () => onDelete(s) }, s.id))), sets.length === 0 && !showNew && (_jsx("li", { className: "col-span-full rounded border border-dashed border-ink-700 px-3 py-4 text-center text-[11px] text-ink-500", children: "No sets in this block yet." }))] })] }));
}
/* ---------------------------------------------------------------------- */
/* Tile                                                                    */
/* ---------------------------------------------------------------------- */
function SetTile({ set, onEdit, onPack, onDelete, }) {
    return (_jsxs("li", { className: "group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40", children: [_jsxs("button", { type: "button", onClick: onEdit, className: "flex flex-1 flex-col gap-2 p-4 text-left", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-sm font-medium text-ink-50", children: set.name }), _jsx("p", { className: "font-mono text-[10px] text-ink-500", children: _jsx("span", { className: "rounded bg-ink-800 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-accent-300", children: set.code }) })] }), _jsx(StatusPill, { status: set.status })] }), set.description && (_jsx("p", { className: "line-clamp-2 text-[11px] leading-snug text-ink-400", children: set.description })), _jsxs("div", { className: "mt-auto flex items-center gap-2 text-[10px] text-ink-500", children: [_jsxs("span", { children: [set.cardCount ?? 0, " card", (set.cardCount ?? 0) === 1 ? "" : "s"] }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: set.releaseDate ? new Date(set.releaseDate).toLocaleDateString() : "no release date" })] })] }), _jsxs("div", { className: "flex border-t border-ink-800", children: [_jsx("button", { type: "button", onClick: onEdit, className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: "Edit" }), _jsx("button", { type: "button", onClick: onPack, className: "flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", title: "Configure pack rules and pull a sample pack", children: "Packs" }), _jsx("button", { type: "button", onClick: onDelete, className: "flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500", children: "Delete" })] })] }));
}
function StatusPill({ status }) {
    const map = {
        draft: "border-ink-700 bg-ink-800 text-ink-400",
        design: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        playtesting: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        locked: "border-sky-500/40 bg-sky-500/10 text-sky-300",
        released: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        archived: "border-ink-700 bg-ink-800 text-ink-600",
    };
    return (_jsx("span", { className: `shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${map[status] ?? map.draft}`, children: status }));
}
/* ---------------------------------------------------------------------- */
/* + new tile                                                              */
/* ---------------------------------------------------------------------- */
function NewSetTile({ projectId, onCreated, }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    function deriveCode(n) {
        const upper = n.toUpperCase().replace(/[^A-Z0-9]/g, "");
        return upper.slice(0, 4) || "SET";
    }
    async function submit(e) {
        e.preventDefault();
        if (!name.trim())
            return;
        setBusy(true);
        try {
            await api.createSet({
                projectId,
                name: name.trim(),
                code: code.trim() || deriveCode(name),
            });
            setName("");
            setCode("");
            setOpen(false);
            onCreated();
        }
        finally {
            setBusy(false);
        }
    }
    if (!open) {
        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setOpen(true), className: "flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300", children: [_jsx("span", { className: "text-2xl", children: "+" }), _jsx("span", { className: "text-xs font-medium", children: "New set" }), _jsx("span", { className: "text-[10px] text-ink-500", children: "Core, Expansion 1, \u2026" })] }) }));
    }
    return (_jsx("li", { children: _jsxs("form", { onSubmit: submit, className: "flex h-full min-h-[160px] flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3", children: [_jsx("p", { className: "text-[10px] uppercase tracking-wider text-accent-300", children: "New set" }), _jsx("input", { type: "text", value: name, onChange: (e) => {
                        setName(e.target.value);
                        if (!code)
                            setCode(deriveCode(e.target.value));
                    }, placeholder: "Core Set", autoFocus: true, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }), _jsx("input", { type: "text", value: code, onChange: (e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)), placeholder: "CORE", className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] uppercase text-ink-100" }), _jsx("p", { className: "text-[10px] text-ink-500", children: "Code is printed on the card. 2-4 uppercase letters / digits." }), _jsxs("div", { className: "mt-auto flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setOpen(false), className: "flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name.trim(), className: "flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40", children: busy ? "…" : "Create" })] })] }) }));
}
/* ---------------------------------------------------------------------- */
/* Editor modal                                                            */
/* ---------------------------------------------------------------------- */
function SetEditor({ set, open, onClose, onSaved, }) {
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [description, setDescription] = useState("");
    const [releaseDate, setReleaseDate] = useState("");
    const [status, setStatus] = useState("draft");
    const [blockId, setBlockId] = useState("");
    const [blocks, setBlocks] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!open || !set)
            return;
        setName(set.name);
        setCode(set.code);
        setDescription(set.description);
        setReleaseDate(set.releaseDate ? set.releaseDate.slice(0, 10) : "");
        setStatus(set.status);
        setBlockId(set.blockId ?? "");
        setError(null);
        // Load blocks for the picker. Cheap — usually < 10 rows per project.
        void api
            .listBlocks({ projectId: set.projectId })
            .then(setBlocks)
            .catch(() => setBlocks([]));
    }, [open, set]);
    if (!open || !set)
        return null;
    async function save() {
        if (!set)
            return;
        setBusy(true);
        setError(null);
        try {
            const updated = await api.updateSet(set.id, {
                name,
                code,
                description,
                releaseDate: releaseDate ? `${releaseDate}T00:00:00.000Z` : null,
                status,
                blockId: blockId || null,
            });
            onSaved(updated);
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": `Edit ${set.name}`, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !busy)
                onClose();
        }, children: _jsxs("div", { className: "flex w-[min(560px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-start justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-50", children: "Edit set" }), _jsx("p", { className: "font-mono text-[11px] text-ink-500", children: set.id })] }), _jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsxs("div", { className: "space-y-3 p-4", children: [_jsx(Field, { label: "Name", children: _jsx("input", { type: "text", value: name, onChange: (e) => setName(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsx(Field, { label: "Code", hint: "Printed on cards. Uppercase A-Z / 0-9.", children: _jsx("input", { type: "text", value: code, onChange: (e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] uppercase text-ink-100" }) }), _jsx(Field, { label: "Description", children: _jsx("textarea", { value: description, onChange: (e) => setDescription(e.target.value), rows: 3, className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsx(Field, { label: "Release date", children: _jsx("input", { type: "date", value: releaseDate, onChange: (e) => setReleaseDate(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsx(Field, { label: "Status", children: _jsx("select", { value: status, onChange: (e) => setStatus(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["draft", "design", "playtesting", "locked", "released", "archived"].map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "Block", hint: "Optional \u2014 group this set under a story arc.", children: _jsxs("select", { value: blockId, onChange: (e) => setBlockId(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: [_jsx("option", { value: "", children: "\u2014 Unblocked \u2014" }), blocks.map((b) => (_jsx("option", { value: b.id, children: b.name }, b.id)))] }) })] }), error && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: error })), _jsxs("footer", { className: "flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-3", children: [_jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "button", onClick: save, disabled: busy, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: busy ? "Saving…" : "Save" })] })] }) }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
