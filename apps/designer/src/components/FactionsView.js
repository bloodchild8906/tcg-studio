import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import { assetBlobUrl } from "@/lib/api";
/**
 * Standalone Factions view (sec 28).
 *
 * Project-wide list of factions — identity (name + color), visuals
 * (icon + frame asset), and lore. The table is the same shape as the
 * keyword glossary view: list left, edit form right, modal-free flow.
 *
 * Cards reference factions via free-form `dataJson.faction` (mono) or
 * `dataJson.factions` (multi). Variant rules in the card type designer
 * already pick those up — defining a faction here makes the picker
 * authoritative and gives the variant system a single source of truth
 * for color/frame mapping.
 */
export function FactionsView() {
    const project = useDesigner(selectActiveProject);
    const [factions, setFactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [creating, setCreating] = useState(false);
    const refresh = useCallback(async () => {
        if (!project) {
            setFactions([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setFactions(await api.listFactions({ projectId: project.id }));
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
    const selected = useMemo(() => factions.find((f) => f.id === selectedId) ?? null, [factions, selectedId]);
    async function handleCreate(input) {
        if (!project)
            return;
        setBusy(true);
        setError(null);
        try {
            const created = await api.createFaction({
                projectId: project.id,
                ...input,
            });
            setFactions((prev) => [...prev, created]);
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
            const updated = await api.updateFaction(id, patch);
            setFactions((prev) => prev.map((f) => (f.id === id ? updated : f)));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
        finally {
            setBusy(false);
        }
    }
    async function handleDelete(id) {
        if (!confirm("Delete this faction? Cards referencing its slug keep their value."))
            return;
        try {
            await api.deleteFaction(id);
            setFactions((prev) => prev.filter((f) => f.id !== id));
            if (selectedId === id)
                setSelectedId(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "delete failed");
        }
    }
    if (!project) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to manage its factions." }) }));
    }
    return (_jsxs("div", { className: "grid grid-cols-[300px_1fr] overflow-hidden", children: [_jsxs("aside", { className: "flex flex-col overflow-hidden border-r border-ink-700 bg-ink-900", children: [_jsxs("header", { className: "border-b border-ink-700 px-3 py-3", children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-base font-semibold text-ink-50", children: "Factions" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [factions.length, " faction", factions.length === 1 ? "" : "s"] }), _jsx("div", { className: "mt-3", children: _jsx("button", { type: "button", onClick: () => {
                                        setSelectedId(null);
                                        setCreating(true);
                                    }, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25", children: "+ New faction" }) })] }), _jsx("ul", { className: "flex-1 overflow-y-auto py-1", children: loading ? (_jsx("li", { className: "px-3 py-4 text-center text-xs text-ink-500", children: "Loading\u2026" })) : factions.length === 0 ? (_jsx("li", { className: "px-3 py-6 text-center text-xs text-ink-500", children: "No factions yet." })) : (factions.map((f) => (_jsxs("li", { onClick: () => {
                                setSelectedId(f.id);
                                setCreating(false);
                            }, className: [
                                "group flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                                selectedId === f.id
                                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                                    : "text-ink-100 hover:bg-ink-800",
                            ].join(" "), children: [_jsx("span", { className: "inline-block h-3 w-3 shrink-0 rounded", style: { background: f.color }, "aria-hidden": "true" }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate font-medium", children: f.name }), _jsx("span", { className: "block truncate font-mono text-[10px] text-ink-500", children: f.slug })] }), f.iconAssetId && (_jsx("span", { className: "inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-800", children: _jsx("img", { src: assetBlobUrl(f.iconAssetId), alt: "", className: "max-h-full max-w-full object-contain" }) }))] }, f.id)))) })] }), _jsxs("main", { className: "overflow-y-auto bg-ink-950 p-6", children: [error && (_jsx("div", { className: "mb-4 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), creating ? (_jsx(FactionCreateForm, { onCancel: () => setCreating(false), onCreate: handleCreate, busy: busy })) : selected ? (_jsx(FactionDetail, { faction: selected, onPatch: (patch) => handlePatch(selected.id, patch), onDelete: () => handleDelete(selected.id), busy: busy })) : (_jsxs("div", { className: "rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500", children: ["Pick a faction on the left, or click ", _jsx("span", { className: "text-ink-300", children: "New faction" }), " to add one."] }))] })] }));
}
function FactionCreateForm({ onCreate, onCancel, busy, }) {
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [color, setColor] = useState("#b34a40");
    const [touchedSlug, setTouchedSlug] = useState(false);
    // Auto-derive slug from name unless the user has already touched it —
    // keeps the form fast for the common case (Fire → fire, Crimson Pact →
    // crimson-pact) without locking out manual overrides.
    function onName(v) {
        setName(v);
        if (!touchedSlug)
            setSlug(slugify(v));
    }
    function submit(e) {
        e.preventDefault();
        if (!name || !slug)
            return;
        onCreate({ name, slug, color });
    }
    return (_jsxs("form", { onSubmit: submit, className: "max-w-md space-y-4", children: [_jsxs("header", { children: [_jsx("h2", { className: "text-base font-semibold text-ink-50", children: "New faction" }), _jsx("p", { className: "mt-1 text-xs text-ink-400", children: "Identity, color, and slug. Icon / frame / lore can be filled in afterwards." })] }), _jsx(Field, { label: "Name", children: _jsx(Input, { value: name, onChange: onName }) }), _jsx(Field, { label: "Slug", hint: "Used in card data and URLs.", children: _jsx(Input, { value: slug, onChange: (v) => {
                        setTouchedSlug(true);
                        setSlug(v);
                    } }) }), _jsx(Field, { label: "Color", hint: "Hex; used by variant rules and badges.", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: color, onChange: (e) => setColor(e.target.value), className: "h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900" }), _jsx(Input, { value: color, onChange: setColor })] }) }), _jsxs("div", { className: "flex items-center gap-2 pt-2", children: [_jsx("button", { type: "button", onClick: onCancel, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name || !slug, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "Creating…" : "Create" })] })] }));
}
function FactionDetail({ faction, onPatch, onDelete, busy, }) {
    // Local mirror so the user sees their typing instantly. We commit on
    // blur (text fields) or on change (color picker / select).
    const [draft, setDraft] = useState(faction);
    useEffect(() => setDraft(faction), [faction]);
    function commitField(key, value) {
        if (faction[key] === value)
            return;
        setDraft({ ...draft, [key]: value });
        onPatch({ [key]: value });
    }
    return (_jsxs("div", { className: "max-w-2xl space-y-4", children: [_jsxs("header", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-base font-semibold text-ink-50", children: faction.name }), _jsx("p", { className: "mt-1 font-mono text-[11px] text-ink-500", children: faction.slug })] }), _jsx("button", { type: "button", onClick: onDelete, disabled: busy, className: "rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20 disabled:opacity-40", children: "Delete" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Name", children: _jsx(Input, { value: draft.name, onChange: (v) => setDraft({ ...draft, name: v }), onBlur: () => commitField("name", draft.name) }) }), _jsx(Field, { label: "Status", children: _jsx(Select, { value: draft.status, options: ["draft", "approved", "deprecated"], onChange: (v) => commitField("status", v) }) }), _jsx(Field, { label: "Color", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: draft.color, onChange: (e) => commitField("color", e.target.value), className: "h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900" }), _jsx(Input, { value: draft.color, onChange: (v) => setDraft({ ...draft, color: v }), onBlur: () => commitField("color", draft.color) })] }) }), _jsx(Field, { label: "Sort order", hint: "Lower appears earlier in pickers.", children: _jsx("input", { type: "number", value: draft.sortOrder, onChange: (e) => {
                                const n = Number(e.target.value);
                                setDraft({ ...draft, sortOrder: Number.isFinite(n) ? n : draft.sortOrder });
                            }, onBlur: () => commitField("sortOrder", draft.sortOrder), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }) })] }), _jsx(Field, { label: "Description", children: _jsx("textarea", { value: draft.description, onChange: (e) => setDraft({ ...draft, description: e.target.value }), onBlur: () => commitField("description", draft.description), rows: 2, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }) }), _jsx(Field, { label: "Icon asset id", hint: "Asset id from the project's library.", children: _jsx(Input, { value: draft.iconAssetId ?? "", onChange: (v) => setDraft({ ...draft, iconAssetId: v.trim() || null }), onBlur: () => commitField("iconAssetId", draft.iconAssetId) }) }), _jsx(Field, { label: "Frame art asset id", hint: "Default frame asset for variant rules.", children: _jsx(Input, { value: draft.frameAssetId ?? "", onChange: (v) => setDraft({ ...draft, frameAssetId: v.trim() || null }), onBlur: () => commitField("frameAssetId", draft.frameAssetId) }) }), _jsx(Field, { label: "Mechanics", hint: "Comma-separated keyword slugs / mechanic names associated with this faction.", children: _jsx(Input, { value: draft.mechanicsJson.join(", "), onChange: (v) => setDraft({
                        ...draft,
                        mechanicsJson: v
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                    }), onBlur: () => commitField("mechanicsJson", draft.mechanicsJson) }) }), _jsx(Field, { label: "Lore", children: _jsx("textarea", { value: draft.lore, onChange: (e) => setDraft({ ...draft, lore: e.target.value }), onBlur: () => commitField("lore", draft.lore), rows: 6, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }) })] }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function Input({ value, onChange, onBlur, }) {
    return (_jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), onBlur: onBlur, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function Select({ value, options, onChange, }) {
    return (_jsx("select", { value: value, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40", children: options.map((o) => (_jsx("option", { value: o, children: o }, o))) }));
}
/** Lightweight slugify — lowercases, strips non-[a-z0-9-], collapses dashes. */
function slugify(input) {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
}
