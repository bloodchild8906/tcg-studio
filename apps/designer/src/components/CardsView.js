import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { selectActiveCardType, selectActiveProject, useDesigner, } from "@/store/designerStore";
import * as api from "@/lib/api";
import { assetBlobUrl } from "@/lib/api";
import { CardPreview } from "@/components/CardPreview";
import { CardImporter } from "@/components/CardImporter";
import { PrintSheetModal } from "@/components/PrintSheetModal";
import { useAssetPicker } from "@/components/AssetPicker";
/**
 * Cards view.
 *
 * Two modes:
 *   • Browse — grid of card preview tiles + "+ New" tile + Import action.
 *   • Edit   — schema-driven editor for a single card, with a "back to grid"
 *              affordance.
 *
 * The store holds the active card id; when it's set we stay in Edit. Coming
 * back to the view from the dashboard / sidebar always lands in Browse.
 *
 * Mode lives in local state (not the store) because it's a per-view UI
 * concern — switching apps shouldn't strand the user mid-edit, but neither
 * should it persist across reloads.
 */
export function CardsView() {
    const activeCardType = useDesigner(selectActiveCardType);
    const cards = useDesigner((s) => s.cards);
    const activeCardId = useDesigner((s) => s.activeCardId);
    const selectCard = useDesigner((s) => s.selectCard);
    const [mode, setMode] = useState("browse");
    const [importerOpen, setImporterOpen] = useState(false);
    const [printOpen, setPrintOpen] = useState(false);
    // When the active card changes externally, follow it into edit.
    useEffect(() => {
        if (activeCardId)
            setMode("edit");
    }, [activeCardId]);
    if (!activeCardType) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a card type from the sidebar / Card Types view to see its cards." }) }));
    }
    if (mode === "edit" && activeCardId) {
        const activeCard = cards.find((c) => c.id === activeCardId) ?? null;
        return (_jsx(CardEditorPage, { card: activeCard, onBack: () => {
                selectCard(null);
                setMode("browse");
            } }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(CardGrid, { onPick: (c) => {
                    selectCard(c.id);
                    setMode("edit");
                }, onImport: () => setImporterOpen(true), onPrintSheet: () => setPrintOpen(true) }), _jsx(CardImporter, { open: importerOpen, onClose: () => setImporterOpen(false), onDone: () => {
                    /* store already refreshed by importer */
                } }), _jsx(PrintSheetModal, { open: printOpen, onClose: () => setPrintOpen(false), cards: cards })] }));
}
/* ---------------------------------------------------------------------- */
/* Browse — grid                                                          */
/* ---------------------------------------------------------------------- */
function CardGrid({ onPick, onImport, onPrintSheet, }) {
    const activeCardType = useDesigner(selectActiveCardType);
    const cards = useDesigner((s) => s.cards);
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return cards;
        return cards.filter((c) => {
            if (c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)) {
                return true;
            }
            const data = c.dataJson ?? {};
            for (const v of Object.values(data)) {
                if (typeof v === "string" && v.toLowerCase().includes(q))
                    return true;
            }
            return false;
        });
    }, [cards, query]);
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-7xl p-6", children: [_jsxs("header", { className: "mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Card type: ", activeCardType?.name] }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Cards" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [cards.length, " card", cards.length === 1 ? "" : "s", " \u00B7 click any tile to edit, or import in bulk."] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search\u2026", className: "h-8 w-48 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }), _jsxs("button", { type: "button", onClick: onImport, className: "inline-flex h-8 items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700", children: [_jsx(ImportIcon, {}), " Import"] }), _jsxs("button", { type: "button", onClick: onPrintSheet, disabled: cards.length === 0, className: "inline-flex h-8 items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: [_jsx(PrintIcon, {}), " Print sheet"] })] })] }), _jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4", children: [_jsx(NewCardTile, {}), filtered.map((card) => (_jsx(CardTile, { card: card, onPick: () => onPick(card) }, card.id)))] }), cards.length > 0 && filtered.length === 0 && (_jsxs("p", { className: "mt-6 text-center text-sm text-ink-500", children: ["No cards match \u201C", query, "\u201D."] }))] }) }));
}
function CardTile({ card, onPick }) {
    // Resolve the set the card belongs to — looked up from the store rather
    // than fetched per tile so render is cheap.
    const set = useDesigner((s) => s.sets.find((ss) => ss.id === card.setId) ?? null);
    return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: onPick, className: "group block w-full text-left transition-transform hover:-translate-y-0.5", children: [_jsx(CardPreview, { card: card, set: set }), _jsxs("div", { className: "mt-2 px-1", children: [_jsx("p", { className: "truncate text-xs font-medium text-ink-100", title: card.name, children: card.name }), _jsx("p", { className: "truncate font-mono text-[10px] text-ink-500", title: card.slug, children: card.slug })] })] }) }));
}
function NewCardTile() {
    const activeCardType = useDesigner(selectActiveCardType);
    const createCardFromPreview = useDesigner((s) => s.createCardFromPreview);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    function autoSlug(s) {
        return s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }
    async function submit(e) {
        e.preventDefault();
        if (!activeCardType || !name.trim())
            return;
        setBusy(true);
        try {
            await createCardFromPreview({
                name: name.trim(),
                slug: autoSlug(name) || "card",
            });
            setName("");
            setOpen(false);
        }
        finally {
            setBusy(false);
        }
    }
    if (!open) {
        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setOpen(true), disabled: !activeCardType, className: "flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-40", children: [_jsx(PlusIcon, {}), _jsx("span", { className: "text-xs font-medium", children: "New card" }), _jsx("span", { className: "text-[10px] text-ink-500", children: "Empty data \u2014 edit after" })] }) }));
    }
    return (_jsx("li", { children: _jsxs("form", { onSubmit: submit, className: "flex aspect-[5/7] w-full flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3", children: [_jsx("p", { className: "text-[10px] uppercase tracking-wider text-accent-300", children: "New card" }), _jsx("input", { type: "text", value: name, onChange: (e) => setName(e.target.value), placeholder: "Card name", autoFocus: true, className: "w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }), _jsx("p", { className: "text-[10px] text-ink-500", children: "Slug auto-generated. Schema fields filled in the editor." }), _jsxs("div", { className: "mt-auto flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setOpen(false), className: "flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name.trim(), className: "flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40", children: busy ? "…" : "Create" })] })] }) }));
}
/* ---------------------------------------------------------------------- */
/* Edit page                                                              */
/* ---------------------------------------------------------------------- */
function CardEditorPage({ card, onBack, }) {
    const activeCardType = useDesigner(selectActiveCardType);
    const deleteCard = useDesigner((s) => s.deleteCard);
    // Resolve the card's set so the preview pane shows the same badge the
    // grid does.
    const cardSet = useDesigner((s) => card ? s.sets.find((ss) => ss.id === card.setId) ?? null : null);
    if (!card || !activeCardType) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Card not found." }) }));
    }
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-3xl p-6", children: [_jsx("button", { type: "button", onClick: onBack, className: "mb-3 inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100", children: "\u2190 Back to grid" }), _jsxs("div", { className: "grid grid-cols-[200px_1fr] gap-6", children: [_jsxs("aside", { className: "space-y-3", children: [_jsx("div", { className: "overflow-hidden rounded-lg border border-ink-700", children: _jsx(CardPreview, { card: card, set: cardSet }) }), _jsx("button", { type: "button", onClick: async () => {
                                        if (confirm(`Delete "${card.name}"?`)) {
                                            await deleteCard(card.id);
                                            onBack();
                                        }
                                    }, className: "w-full rounded border border-transparent px-2 py-1 text-xs text-ink-400 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500", children: "Delete card" })] }), _jsxs("main", { children: [_jsxs("header", { className: "mb-4", children: [_jsx("h1", { className: "text-lg font-semibold text-ink-50", children: card.name }), _jsx("p", { className: "font-mono text-[11px] text-ink-500", children: card.slug })] }), _jsx(CardEditorForm, { card: card, schemaJson: activeCardType.schemaJson })] })] })] }) }));
}
function parseSchema(json) {
    if (typeof json !== "object" || json === null)
        return { fields: [] };
    const fieldsRaw = json.fields;
    if (!Array.isArray(fieldsRaw))
        return { fields: [] };
    const fields = [];
    for (const f of fieldsRaw) {
        if (typeof f === "object" && f && typeof f.key === "string") {
            const obj = f;
            fields.push({
                key: obj.key,
                type: typeof obj.type === "string" ? obj.type : "text",
                required: typeof obj.required === "boolean" ? obj.required : false,
                min: typeof obj.min === "number" ? obj.min : undefined,
                max: typeof obj.max === "number" ? obj.max : undefined,
            });
        }
    }
    return { fields };
}
function buildFormState(card) {
    return {
        name: card.name,
        slug: card.slug,
        status: card.status,
        rarity: card.rarity ?? "",
        collectorNumber: card.collectorNumber === null || card.collectorNumber === undefined
            ? ""
            : String(card.collectorNumber),
        setId: card.setId ?? "",
        data: { ...(card.dataJson ?? {}) },
    };
}
function CardEditorForm({ card, schemaJson }) {
    const schema = useMemo(() => parseSchema(schemaJson), [schemaJson]);
    const sets = useDesigner((s) => s.sets);
    const [form, setForm] = useState(() => buildFormState(card));
    const [saveState, setSaveState] = useState("idle");
    const [error, setError] = useState(null);
    useEffect(() => {
        setForm(buildFormState(card));
        setSaveState("idle");
    }, [card]);
    const dirty = JSON.stringify(buildFormState(card)) !== JSON.stringify(form);
    function setData(key, value) {
        setForm((f) => ({ ...f, data: { ...f.data, [key]: value } }));
    }
    async function save() {
        setSaveState("saving");
        setError(null);
        try {
            const coerced = { ...form.data };
            for (const f of schema.fields) {
                if (f.type === "number" && typeof coerced[f.key] === "string") {
                    const v = coerced[f.key].trim();
                    coerced[f.key] = v === "" ? undefined : Number(v);
                }
            }
            const updated = await api.updateCardData(card.id, {
                name: form.name,
                slug: form.slug,
                dataJson: coerced,
                status: form.status,
                rarity: form.rarity ? form.rarity : null,
                collectorNumber: form.collectorNumber === "" ? null : Number(form.collectorNumber),
                setId: form.setId ? form.setId : null,
            });
            useDesigner.setState((s) => ({
                cards: s.cards.map((c) => (c.id === updated.id ? updated : c)),
            }));
            setSaveState("saved");
            setTimeout(() => setSaveState("idle"), 1200);
        }
        catch (err) {
            setSaveState("error");
            setError(err instanceof Error ? err.message : "save failed");
        }
    }
    const knownKeys = new Set(schema.fields.map((f) => f.key));
    const extraEntries = Object.entries(form.data).filter(([k]) => !knownKeys.has(k));
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Section, { title: "Identity", children: [_jsx(FieldRow, { label: "Name", children: _jsx(Input, { value: form.name, onChange: (v) => setForm((f) => ({ ...f, name: v })) }) }), _jsx(FieldRow, { label: "Slug", children: _jsx(Input, { value: form.slug, mono: true, onChange: (v) => setForm((f) => ({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })) }) }), _jsx(FieldRow, { label: "Rarity", children: _jsx(Input, { value: form.rarity, onChange: (v) => setForm((f) => ({ ...f, rarity: v })), placeholder: "Common, Uncommon, Rare, Mythic\u2026" }) }), _jsx(FieldRow, { label: "Collector #", children: _jsx(Input, { value: form.collectorNumber, onChange: (v) => setForm((f) => ({ ...f, collectorNumber: v.replace(/[^0-9]/g, "") })), placeholder: "optional" }) }), _jsx(FieldRow, { label: "Status", children: _jsx(SelectInput, { value: form.status, options: [
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
                            ], onChange: (v) => setForm((f) => ({ ...f, status: v })) }) }), _jsx(FieldRow, { label: "Set", hint: "Group the card into a release.", children: _jsxs("select", { value: form.setId, onChange: (e) => setForm((f) => ({ ...f, setId: e.target.value })), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40", children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), sets.map((s) => (_jsxs("option", { value: s.id, children: [s.code, " \u00B7 ", s.name] }, s.id)))] }) })] }), _jsxs(Section, { title: "Card data", children: [schema.fields.length === 0 ? (_jsx("p", { className: "text-[11px] text-ink-500", children: "This card type has no schema fields. Add some via the API to get a structured form." })) : (schema.fields.map((field) => (_jsx(FieldRow, { label: `${field.key}${field.required ? " *" : ""}`, hint: `type: ${field.type}`, children: _jsx(SchemaInput, { field: field, value: form.data[field.key], onChange: (v) => setData(field.key, v) }) }, field.key)))), extraEntries.length > 0 && (_jsxs("div", { className: "mt-4 border-t border-ink-800 pt-3", children: [_jsx("p", { className: "mb-2 text-[10px] uppercase tracking-wider text-ink-500", children: "Extra fields (not in schema)" }), extraEntries.map(([key, value]) => (_jsx(FieldRow, { label: key, children: _jsx(Input, { value: String(value ?? ""), onChange: (v) => setData(key, v) }) }, key)))] }))] }), _jsxs("div", { className: "sticky bottom-0 -mx-6 flex items-center justify-between border-t border-ink-800 bg-ink-950/90 px-6 py-3 backdrop-blur", children: [_jsx("span", { className: "text-[11px] text-ink-500", children: saveState === "saving"
                            ? "Saving…"
                            : saveState === "saved"
                                ? "Saved."
                                : saveState === "error"
                                    ? `Error: ${error ?? "unknown"}`
                                    : dirty
                                        ? "Unsaved changes"
                                        : "Up to date" }), _jsx("button", { type: "button", onClick: save, disabled: !dirty || saveState === "saving", className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: "Save" })] })] }));
}
function SchemaInput({ field, value, onChange, }) {
    // Promote certain text-typed fields to richer pickers based on their
    // semantic key. This keeps existing schemas backwards-compatible (no
    // migration needed) while letting card editors get a real UI for
    // faction selection / keyword tagging.
    const semanticType = field.type === "text" && (field.key === "faction" || field.key === "factions" || field.key === "keywords")
        ? field.key === "factions"
            ? "factionMulti"
            : field.key === "keywords"
                ? "keywordMulti"
                : "faction"
        : field.type;
    switch (semanticType) {
        case "faction":
            return _jsx(FactionPicker, { value: value, onChange: onChange });
        case "factionMulti":
            return _jsx(FactionPicker, { value: value, onChange: onChange, multi: true });
        case "keywordMulti":
            return _jsx(KeywordChips, { value: value, onChange: onChange });
        case "longText":
        case "richText":
            return (_jsx("textarea", { value: String(value ?? ""), rows: field.type === "richText" ? 5 : 3, onChange: (e) => onChange(e.target.value), className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
        case "number":
            return (_jsx(Input, { value: value === undefined || value === null ? "" : String(value), onChange: (v) => onChange(v.replace(/[^0-9.\-]/g, "")), placeholder: field.min !== undefined || field.max !== undefined
                    ? `${field.min ?? "−∞"}..${field.max ?? "∞"}`
                    : "number" }));
        case "boolean":
            return (_jsxs("label", { className: "inline-flex items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs", children: [_jsx("input", { type: "checkbox", checked: Boolean(value), onChange: (e) => onChange(e.target.checked), className: "accent-accent-500" }), _jsx("span", { children: Boolean(value) ? "true" : "false" })] }));
        case "stat":
            return _jsx(Input, { value: String(value ?? ""), onChange: (v) => onChange(v), placeholder: "e.g. 3 / 4" });
        case "image":
            return _jsx(ImageFieldInput, { value: value, onChange: onChange });
        default:
            return _jsx(Input, { value: String(value ?? ""), onChange: (v) => onChange(v) });
    }
}
/**
 * Image-typed schema field. Drives card art: the user picks an asset from
 * the project's library; the value stored in `dataJson[field.key]` is the
 * asset id. CardRender resolves it to a blob URL at preview time.
 */
function ImageFieldInput({ value, onChange, }) {
    // Reuse the AssetPicker — already project-scoped, supports inline upload.
    const picker = useAssetPicker((asset) => onChange(asset.id));
    const stored = typeof value === "string" ? value : null;
    const isUrl = stored ? /^(https?:|data:|blob:|\/)/.test(stored) : false;
    const previewUrl = stored ? (isUrl ? stored : assetBlobUrl(stored)) : null;
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] [background-size:8px_8px]", children: previewUrl ? (_jsx("img", { src: previewUrl, alt: "", className: "max-h-full max-w-full object-contain" })) : (_jsx("span", { className: "text-[10px] text-ink-600", children: "empty" })) }), _jsx("div", { className: "min-w-0 flex-1", children: stored ? (_jsx("p", { className: "truncate font-mono text-[10px] text-ink-400", title: stored, children: stored })) : (_jsx("p", { className: "text-[11px] text-ink-500", children: "No image bound." })) }), _jsx("button", { type: "button", onClick: picker.open, className: "rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700", children: stored ? "Change…" : "Pick…" }), stored && (_jsx("button", { type: "button", onClick: () => onChange(""), className: "rounded border border-transparent px-1.5 py-1 text-[11px] text-ink-400 hover:border-ink-700 hover:bg-ink-800", title: "Clear", children: "\u00D7" })), picker.element] }));
}
/**
 * Faction picker — populates the dropdown from the project's factions.
 * Falls back to a free-form text input when no factions are defined yet,
 * so the form keeps working in projects that haven't started using the
 * faction system. The single-select form stores `slug`; the multi form
 * stores an array of slugs.
 *
 * Uses a ref-counted in-memory cache keyed by projectId so a card
 * editor with multiple faction fields doesn't trigger one fetch per
 * field. The cache is flushed when the project changes.
 */
function FactionPicker({ value, onChange, multi = false, }) {
    const factions = useFactionsCache();
    if (factions === null) {
        return _jsx(Input, { value: "", onChange: () => { }, placeholder: "Loading\u2026" });
    }
    if (factions.length === 0) {
        // No factions defined — fall back to text so the user still has a way
        // to enter the value while seeding the system.
        return (_jsx(Input, { value: Array.isArray(value) ? value.join(", ") : String(value ?? ""), onChange: (v) => onChange(multi ? v.split(",").map((s) => s.trim()).filter(Boolean) : v), placeholder: "No factions defined yet \u2014 type to set" }));
    }
    if (multi) {
        const arr = Array.isArray(value) ? value : [];
        return (_jsxs("div", { className: "space-y-1.5", children: [_jsx("div", { className: "flex flex-wrap gap-1", children: factions.map((f) => {
                        const selected = arr.includes(f.slug);
                        return (_jsxs("button", { type: "button", onClick: () => {
                                const next = selected
                                    ? arr.filter((x) => x !== f.slug)
                                    : [...arr, f.slug];
                                onChange(next);
                            }, className: [
                                "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px]",
                                selected
                                    ? "border-accent-500/60 bg-accent-500/15 text-accent-200"
                                    : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
                            ].join(" "), children: [_jsx("span", { className: "inline-block h-2 w-2 rounded", style: { background: f.color }, "aria-hidden": "true" }), f.name] }, f.id));
                    }) }), arr.length > 0 && (_jsx("p", { className: "font-mono text-[10px] text-ink-500", children: arr.join(", ") }))] }));
    }
    const stored = typeof value === "string" ? value : "";
    const matched = factions.find((f) => f.slug === stored);
    return (_jsxs("div", { className: "flex items-center gap-2", children: [matched && (_jsx("span", { className: "inline-block h-3 w-3 shrink-0 rounded", style: { background: matched.color }, "aria-hidden": "true" })), _jsxs("select", { value: stored, onChange: (e) => onChange(e.target.value || null), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40", children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), factions.map((f) => (_jsx("option", { value: f.slug, children: f.name }, f.id)))] })] }));
}
/**
 * Keyword chips — multi-select over the project's keywords. Stores an
 * array of slugs. Same fallback as `FactionPicker` when nothing's defined.
 */
function KeywordChips({ value, onChange, }) {
    const keywords = useKeywordsCache();
    const arr = Array.isArray(value) ? value : [];
    if (keywords === null) {
        return _jsx(Input, { value: "", onChange: () => { }, placeholder: "Loading\u2026" });
    }
    if (keywords.length === 0) {
        return (_jsx(Input, { value: arr.join(", "), onChange: (v) => onChange(v.split(",").map((s) => s.trim()).filter(Boolean)), placeholder: "No keywords defined yet \u2014 type comma-separated" }));
    }
    return (_jsxs("div", { className: "space-y-1.5", children: [_jsx("div", { className: "flex flex-wrap gap-1", children: keywords.map((k) => {
                    const selected = arr.includes(k.slug);
                    return (_jsxs("button", { type: "button", onClick: () => {
                            const next = selected ? arr.filter((x) => x !== k.slug) : [...arr, k.slug];
                            onChange(next);
                        }, className: [
                            "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
                            selected
                                ? "border-accent-500/60 bg-accent-500/15 text-accent-200"
                                : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
                        ].join(" "), title: k.reminderText || k.rulesDefinition, children: [k.color && (_jsx("span", { className: "inline-block h-2 w-2 rounded", style: { background: k.color }, "aria-hidden": "true" })), k.name] }, k.id));
                }) }), arr.length > 0 && (_jsx("p", { className: "font-mono text-[10px] text-ink-500", children: arr.join(", ") }))] }));
}
// In-memory caches, project-scoped. Pure module state — fine because the
// designer is single-tenant per session, and the cache is invalidated on
// project change automatically by reading projectId from the store.
const _factionCache = {
    projectId: null,
    data: null,
};
const _keywordCache = {
    projectId: null,
    data: null,
};
function useFactionsCache() {
    const project = useDesigner(selectActiveProject);
    const [data, setData] = useState(null);
    useEffect(() => {
        if (!project) {
            setData([]);
            return;
        }
        if (_factionCache.projectId === project.id && _factionCache.data) {
            setData(_factionCache.data);
            return;
        }
        let cancelled = false;
        void api.listFactions({ projectId: project.id }).then((rows) => {
            if (cancelled)
                return;
            _factionCache.projectId = project.id;
            _factionCache.data = rows;
            setData(rows);
        });
        return () => {
            cancelled = true;
        };
    }, [project]);
    return data;
}
function useKeywordsCache() {
    const project = useDesigner(selectActiveProject);
    const [data, setData] = useState(null);
    useEffect(() => {
        if (!project) {
            setData([]);
            return;
        }
        if (_keywordCache.projectId === project.id && _keywordCache.data) {
            setData(_keywordCache.data);
            return;
        }
        let cancelled = false;
        void api.listKeywords({ projectId: project.id }).then((rows) => {
            if (cancelled)
                return;
            _keywordCache.projectId = project.id;
            _keywordCache.data = rows;
            setData(rows);
        });
        return () => {
            cancelled = true;
        };
    }, [project]);
    return data;
}
/* ---------------------------------------------------------------------- */
/* Primitives                                                             */
/* ---------------------------------------------------------------------- */
function Section({ title, children, }) {
    return (_jsxs("section", { className: "space-y-3 rounded-lg border border-ink-700 bg-ink-900/60 p-4", children: [_jsx("h3", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: title }), _jsx("div", { className: "space-y-3", children: children })] }));
}
function FieldRow({ label, hint, children, }) {
    return (_jsxs("label", { className: "grid grid-cols-[140px_1fr] items-start gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-[11px] font-medium text-ink-200", children: label }), hint && _jsx("div", { className: "font-mono text-[10px] text-ink-500", children: hint })] }), _jsx("div", { children: children })] }));
}
function Input({ value, onChange, placeholder, mono, }) {
    return (_jsx("input", { type: "text", value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value), className: [
            "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-600 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40",
            mono && "font-mono",
        ]
            .filter(Boolean)
            .join(" ") }));
}
function SelectInput({ value, options, onChange, }) {
    return (_jsx("select", { value: value, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40", children: options.map((o) => (_jsx("option", { value: o, children: o }, o))) }));
}
function PlusIcon() {
    return (_jsx("svg", { className: "h-6 w-6", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M12 5v14M5 12h14" }) }));
}
function ImportIcon() {
    return (_jsx("svg", { className: "h-3.5 w-3.5", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 11V3M5 6l3-3 3 3M3 13h10" }) }));
}
function PrintIcon() {
    return (_jsx("svg", { className: "h-3.5 w-3.5", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M4 6V2.5h8V6M4 11H2.5v-4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4H12M4 9h8v4.5H4V9z" }) }));
}
