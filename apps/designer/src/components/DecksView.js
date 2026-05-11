import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
/**
 * Decks view (sec 30).
 *
 * Two modes:
 *   • Browse — grid of decks in the project (name, format, status,
 *     card count). Plus a "+ New deck" tile.
 *   • Edit   — open a single deck for header edits + a card list editor
 *     that lets the user search the project's cards and add/remove
 *     entries with quantities. Also offers a Tabletop Simulator export.
 *
 * The edit form's "Cards" panel is the meaty bit: a left search list
 * over the project's cards, a right deck list grouped by sideboard +
 * category, and per-row quantity steppers. Saving the cards bulk-replaces
 * the deck's slot list via PUT /decks/:id/cards.
 */
export function DecksView() {
    const project = useDesigner(selectActiveProject);
    const [decks, setDecks] = useState([]);
    const [factions, setFactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [creating, setCreating] = useState(false);
    const refresh = useCallback(async () => {
        if (!project) {
            setDecks([]);
            setFactions([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const [d, f] = await Promise.all([
                api.listDecks({ projectId: project.id }),
                api.listFactions({ projectId: project.id }).catch(() => []),
            ]);
            setDecks(d);
            setFactions(f);
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
    if (!project) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to manage its decks." }) }));
    }
    if (editingId) {
        return (_jsx(DeckEditor, { deckId: editingId, onClose: () => {
                setEditingId(null);
                void refresh();
            } }));
    }
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-6xl p-6", children: [_jsxs("header", { className: "mb-5 flex items-end justify-between", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Decks" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [decks.length, " deck", decks.length === 1 ? "" : "s", " \u00B7 pre-built starters and player builds."] })] }), _jsx("button", { type: "button", onClick: () => setCreating(true), className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25", children: "+ New deck" })] }), error && (_jsx("div", { className: "mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), creating && (_jsx(NewDeckForm, { projectId: project.id, factions: factions, onCancel: () => setCreating(false), onCreated: (d) => {
                        setDecks((prev) => [...prev, d]);
                        setCreating(false);
                        setEditingId(d.id);
                    } })), loading && decks.length === 0 ? (_jsx("p", { className: "py-6 text-center text-sm text-ink-500", children: "Loading\u2026" })) : (_jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3", children: [decks.map((d) => (_jsxs("li", { className: "group flex flex-col rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40", children: [_jsxs("button", { type: "button", onClick: () => setEditingId(d.id), className: "flex flex-1 flex-col gap-2 p-4 text-left", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-sm font-medium text-ink-50", children: d.name }), _jsx("p", { className: "font-mono text-[10px] text-ink-500", children: d.slug })] }), _jsx("span", { className: "rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300", children: d.format })] }), d.description && (_jsx("p", { className: "line-clamp-2 text-[11px] leading-snug text-ink-400", children: d.description })), _jsxs("div", { className: "mt-auto flex items-center gap-2 text-[10px] text-ink-500", children: [_jsxs("span", { children: [d.cardCount ?? 0, " card slots"] }), _jsx("span", { children: "\u00B7" }), _jsx("span", { className: "capitalize", children: d.status })] })] }), _jsxs("div", { className: "flex border-t border-ink-800", children: [_jsx("button", { type: "button", onClick: () => setEditingId(d.id), className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: "Open" }), _jsx("button", { type: "button", onClick: async () => {
                                                if (!confirm(`Delete deck "${d.name}"?`))
                                                    return;
                                                try {
                                                    await api.deleteDeck(d.id);
                                                    await refresh();
                                                }
                                                catch (err) {
                                                    setError(err instanceof Error ? err.message : "delete failed");
                                                }
                                            }, className: "flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500", children: "Delete" })] })] }, d.id))), !loading && decks.length === 0 && (_jsx("li", { className: "col-span-full rounded border border-dashed border-ink-700 px-3 py-10 text-center text-xs text-ink-500", children: "No decks yet \u2014 create one to start building card lists." }))] }))] }) }));
}
/* ====================================================================== */
/* New deck form                                                           */
/* ====================================================================== */
function NewDeckForm({ projectId, factions, onCreated, onCancel, }) {
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [format, setFormat] = useState("constructed");
    const [factionId, setFactionId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [touchedSlug, setTouchedSlug] = useState(false);
    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const created = await api.createDeck({
                projectId,
                name,
                slug,
                format,
                factionId: factionId || null,
            });
            onCreated(created);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "create failed");
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("form", { onSubmit: submit, className: "mb-4 grid grid-cols-[1fr_180px_140px_180px_auto_auto] items-end gap-2 rounded border border-accent-500/40 bg-accent-500/5 p-3", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Name" }), _jsx("input", { type: "text", value: name, autoFocus: true, onChange: (e) => {
                            setName(e.target.value);
                            if (!touchedSlug)
                                setSlug(slugify(e.target.value));
                        }, placeholder: "Crimson Dawn Constructed", className: "mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Slug" }), _jsx("input", { type: "text", value: slug, onChange: (e) => {
                            setTouchedSlug(true);
                            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
                        }, className: "mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Format" }), _jsx("input", { type: "text", value: format, onChange: (e) => setFormat(e.target.value), placeholder: "constructed / draft / commander", className: "mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Faction" }), _jsxs("select", { value: factionId, onChange: (e) => setFactionId(e.target.value), className: "mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: [_jsx("option", { value: "", children: "\u2014 Any \u2014" }), factions.map((f) => (_jsx("option", { value: f.id, children: f.name }, f.id)))] })] }), _jsx("button", { type: "button", onClick: onCancel, disabled: busy, className: "rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name || !slug, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "…" : "Create" }), error && _jsx("p", { className: "col-span-full text-[11px] text-danger-500", children: error })] }));
}
/* ====================================================================== */
/* Deck editor                                                             */
/* ====================================================================== */
function DeckEditor({ deckId, onClose }) {
    const project = useDesigner(selectActiveProject);
    const [deck, setDeck] = useState(null);
    const [allCards, setAllCards] = useState([]);
    const [slots, setSlots] = useState([]);
    const [search, setSearch] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [savedTick, setSavedTick] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            api.getDeck(deckId),
            project ? api.listCards({ projectId: project.id }) : Promise.resolve([]),
        ])
            .then(([d, cards]) => {
            if (cancelled)
                return;
            setDeck(d);
            setAllCards(cards);
            setSlots((d.cards ?? []).map((c) => ({
                cardId: c.cardId,
                quantity: c.quantity,
                sideboard: c.sideboard,
                category: c.category,
            })));
        })
            .catch((err) => {
            if (cancelled)
                return;
            setError(err instanceof Error ? err.message : "load failed");
        });
        return () => {
            cancelled = true;
        };
    }, [deckId, project]);
    const cardById = useMemo(() => {
        const m = new Map();
        for (const c of allCards)
            m.set(c.id, c);
        return m;
    }, [allCards]);
    const filteredCards = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q)
            return allCards;
        return allCards.filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q));
    }, [allCards, search]);
    function setSlotQty(cardId, sideboard, qty) {
        setSlots((prev) => {
            // Replace, add, or drop the row depending on the new qty.
            const idx = prev.findIndex((s) => s.cardId === cardId && s.sideboard === sideboard);
            if (qty <= 0) {
                if (idx < 0)
                    return prev;
                return prev.filter((_, i) => i !== idx);
            }
            const clamped = Math.min(99, Math.max(1, qty));
            if (idx >= 0) {
                return prev.map((s, i) => (i === idx ? { ...s, quantity: clamped } : s));
            }
            return [...prev, { cardId, quantity: clamped, sideboard, category: "" }];
        });
    }
    function adjustSlot(cardId, sideboard, delta) {
        const existing = slots.find((s) => s.cardId === cardId && s.sideboard === sideboard);
        setSlotQty(cardId, sideboard, (existing?.quantity ?? 0) + delta);
    }
    async function save() {
        setBusy(true);
        setError(null);
        try {
            await api.replaceDeckCards(deckId, slots);
            setSavedTick(true);
            setTimeout(() => setSavedTick(false), 1200);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
        finally {
            setBusy(false);
        }
    }
    async function patchDeck(p) {
        if (!deck)
            return;
        try {
            const updated = await api.updateDeck(deck.id, p);
            setDeck(updated);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
    }
    if (!deck) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950 text-sm text-ink-500", children: error ?? "Loading deck…" }));
    }
    const mainSlots = slots.filter((s) => !s.sideboard);
    const sideSlots = slots.filter((s) => s.sideboard);
    const totalMain = mainSlots.reduce((n, s) => n + s.quantity, 0);
    const totalSide = sideSlots.reduce((n, s) => n + s.quantity, 0);
    return (_jsxs("div", { className: "grid grid-cols-[260px_1fr_360px] overflow-hidden", children: [_jsxs("aside", { className: "flex flex-col overflow-hidden border-r border-ink-700 bg-ink-900", children: [_jsxs("header", { className: "border-b border-ink-700 px-3 py-3", children: [_jsx("button", { type: "button", onClick: onClose, className: "text-[11px] text-ink-400 hover:text-ink-100", children: "\u2190 Back to decks" }), _jsx("h2", { className: "mt-2 text-sm font-medium text-ink-50", children: "Card library" }), _jsx("input", { type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search\u2026", className: "mt-2 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500" })] }), _jsxs("ul", { className: "flex-1 overflow-y-auto py-1", children: [filteredCards.map((c) => {
                                const mainQty = slots.find((s) => s.cardId === c.id && !s.sideboard)?.quantity ?? 0;
                                const sideQty = slots.find((s) => s.cardId === c.id && s.sideboard)?.quantity ?? 0;
                                return (_jsxs("li", { className: "flex items-center gap-2 px-2 py-1 text-xs text-ink-100 hover:bg-ink-800", children: [_jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate", children: c.name }), _jsx("span", { className: "block truncate font-mono text-[10px] text-ink-500", children: c.slug })] }), _jsx(SlotStepper, { qty: mainQty, onAdjust: (d) => adjustSlot(c.id, false, d), label: "M" }), _jsx(SlotStepper, { qty: sideQty, onAdjust: (d) => adjustSlot(c.id, true, d), label: "S" })] }, c.id));
                            }), filteredCards.length === 0 && (_jsx("li", { className: "px-3 py-6 text-center text-[11px] text-ink-500", children: "No cards match." }))] })] }), _jsxs("main", { className: "flex flex-col overflow-hidden bg-ink-950", children: [_jsx("header", { className: "border-b border-ink-700 px-4 py-3", children: _jsxs("div", { className: "flex items-baseline justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-base font-semibold text-ink-50", children: deck.name }), _jsx("p", { className: "font-mono text-[11px] text-ink-500", children: deck.slug })] }), _jsxs("div", { className: "text-[11px] text-ink-400", children: ["Main: ", _jsx("span", { className: "text-ink-100", children: totalMain }), " \u00B7 Side:", " ", _jsx("span", { className: "text-ink-100", children: totalSide })] })] }) }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4", children: [_jsx(DeckSection, { title: "Main deck", slots: mainSlots, cardById: cardById, onAdjust: (cardId, d) => adjustSlot(cardId, false, d), onRemove: (cardId) => setSlotQty(cardId, false, 0) }), _jsx("div", { className: "mt-4", children: _jsx(DeckSection, { title: "Sideboard", slots: sideSlots, cardById: cardById, onAdjust: (cardId, d) => adjustSlot(cardId, true, d), onRemove: (cardId) => setSlotQty(cardId, true, 0) }) })] }), _jsxs("footer", { className: "flex items-center justify-between gap-3 border-t border-ink-700 px-4 py-3", children: [_jsx("span", { className: "text-[11px] text-ink-500", children: error
                                    ? _jsx("span", { className: "text-danger-500", children: error })
                                    : savedTick
                                        ? "Saved."
                                        : `${slots.length} unique slot${slots.length === 1 ? "" : "s"}` }), _jsx("button", { type: "button", onClick: save, disabled: busy, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "Saving…" : "Save deck" })] })] }), _jsxs("aside", { className: "flex flex-col gap-3 overflow-y-auto border-l border-ink-700 bg-ink-900 p-4", children: [_jsx(Field, { label: "Name", children: _jsx(Input, { value: deck.name, onCommit: (v) => patchDeck({ name: v }) }) }), _jsx(Field, { label: "Format", children: _jsx(Input, { value: deck.format, onCommit: (v) => patchDeck({ format: v }) }) }), _jsx(Field, { label: "Status", children: _jsx("select", { value: deck.status, onChange: (e) => void patchDeck({ status: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["draft", "testing", "locked", "published", "archived"].map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "Visibility", children: _jsx("select", { value: deck.visibility, onChange: (e) => void patchDeck({ visibility: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["private", "tenant_internal", "project_internal", "public"].map((v) => (_jsx("option", { value: v, children: v.replace(/_/g, " ") }, v))) }) }), _jsx(Field, { label: "Description", children: _jsx("textarea", { value: deck.description, onChange: (e) => setDeck({ ...deck, description: e.target.value }), onBlur: () => patchDeck({ description: deck.description }), rows: 4, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsxs("div", { className: "mt-2 rounded border border-ink-700 bg-ink-950/40 p-3", children: [_jsx("h3", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: "Export" }), _jsx("p", { className: "mt-1 text-[11px] text-ink-500", children: "Generate a Tabletop Simulator JSON saved-object that imports the deck with face images served from the public asset endpoint." }), _jsx("button", { type: "button", onClick: () => triggerTtsExport(deck, slots, cardById), disabled: slots.length === 0, className: "mt-2 inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Download TTS JSON" }), _jsx("button", { type: "button", onClick: () => downloadDeckJson(deck, slots, cardById), className: "ml-2 inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", disabled: slots.length === 0, children: "Plain JSON" })] })] })] }));
}
function DeckSection({ title, slots, cardById, onAdjust, onRemove, }) {
    return (_jsxs("section", { children: [_jsxs("h3", { className: "mb-1 text-[11px] uppercase tracking-wider text-ink-400", children: [title, " ", _jsxs("span", { className: "text-ink-500", children: ["(", slots.reduce((n, s) => n + s.quantity, 0), ")"] })] }), slots.length === 0 ? (_jsx("p", { className: "rounded border border-dashed border-ink-700 px-3 py-3 text-center text-[11px] text-ink-500", children: "Empty." })) : (_jsx("ul", { className: "divide-y divide-ink-800 rounded border border-ink-800", children: slots.map((s) => {
                    const c = cardById.get(s.cardId);
                    return (_jsxs("li", { className: "flex items-center gap-2 px-3 py-1.5 text-xs", children: [_jsxs("span", { className: "w-8 shrink-0 text-right font-mono tabular-nums text-ink-300", children: ["\u00D7", s.quantity] }), _jsx("span", { className: "min-w-0 flex-1 truncate text-ink-100", children: c?.name ?? _jsx("span", { className: "text-ink-500", children: "(missing card)" }) }), c?.rarity && (_jsx("span", { className: "rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-300", children: c.rarity })), _jsx(SlotStepper, { qty: s.quantity, onAdjust: (d) => onAdjust(s.cardId, d) }), _jsx("button", { type: "button", onClick: () => onRemove(s.cardId), className: "text-ink-500 hover:text-danger-500", title: "Remove", children: "\u00D7" })] }, `${s.cardId}-${s.sideboard}`));
                }) }))] }));
}
function SlotStepper({ qty, onAdjust, label, }) {
    return (_jsxs("span", { className: "inline-flex items-center gap-0.5 rounded border border-ink-700 bg-ink-900 text-[10px]", children: [_jsx("button", { type: "button", onClick: () => onAdjust(-1), disabled: qty === 0, className: "px-1 text-ink-400 hover:text-ink-100 disabled:opacity-30", children: "\u2212" }), _jsx("span", { className: "w-5 text-center font-mono tabular-nums text-ink-200", children: qty }), _jsx("button", { type: "button", onClick: () => onAdjust(1), className: "px-1 text-ink-400 hover:text-ink-100", children: "+" }), label && _jsx("span", { className: "border-l border-ink-700 px-1 text-ink-500", children: label })] }));
}
function Field({ label, children }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children] }));
}
function Input({ value, onCommit, }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (_jsx("input", { type: "text", value: draft, onChange: (e) => setDraft(e.target.value), onBlur: () => {
            if (draft !== value)
                onCommit(draft);
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }));
}
function slugify(input) {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
}
/* ====================================================================== */
/* Tabletop Simulator export                                                */
/* ====================================================================== */
/**
 * Build a Tabletop Simulator "saved object" JSON for the deck. TTS
 * imports a `Deck` object as a single tabletop entity that can be
 * dragged into a save. The format isn't formally specified by Berserk
 * Games, but the shape below works with TTS's "Saved Objects" load
 * dialog (and matches TTSCardConverter / Frosthaven Reader exports).
 *
 * Each card needs a unique CardID and a cell index into `CustomDeck`.
 * For MVP we point both face and back at a placeholder image — a
 * future iteration can rasterize each card to a pre-built tile via
 * the same pipeline the print sheet uses, then upload as a public
 * asset and reference here.
 */
function buildTtsDeck(deck, slots, cardById) {
    const main = slots.filter((s) => !s.sideboard);
    // Expand quantities — TTS needs one entry per physical card.
    const expanded = [];
    let idx = 0;
    for (const s of main) {
        for (let q = 0; q < s.quantity; q++) {
            expanded.push({ cardId: s.cardId, idx: idx++ });
        }
    }
    return {
        SaveName: deck.name,
        GameMode: "Custom",
        Date: new Date().toISOString(),
        Table: "",
        ObjectStates: [
            {
                Name: "DeckCustom",
                Transform: { posX: 0, posY: 1, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
                Nickname: deck.name,
                Description: deck.description,
                // CardIDs map into `CustomDeck` entries by their thousands digit.
                // A single CustomDeck (id: 1) is fine for an MVP.
                DeckIDs: expanded.map((_, i) => 100 + i),
                CustomDeck: {
                    "1": {
                        FaceURL: "https://placeholder.tcgstudio.local/card-face.png",
                        BackURL: "https://placeholder.tcgstudio.local/card-back.png",
                        NumWidth: Math.max(1, Math.ceil(Math.sqrt(expanded.length))),
                        NumHeight: Math.max(1, Math.ceil(expanded.length / Math.max(1, Math.ceil(Math.sqrt(expanded.length))))),
                        BackIsHidden: true,
                        UniqueBack: false,
                        Type: 0,
                    },
                },
                ContainedObjects: expanded.map((e, i) => {
                    const c = cardById.get(e.cardId);
                    return {
                        Name: "Card",
                        Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
                        Nickname: c?.name ?? "Unknown",
                        Description: typeof c?.dataJson === "object" && c?.dataJson != null && "rules_text" in c.dataJson
                            ? String(c.dataJson.rules_text ?? "")
                            : "",
                        CardID: 100 + i,
                    };
                }),
            },
        ],
    };
}
function triggerTtsExport(deck, slots, cardById) {
    const obj = buildTtsDeck(deck, slots, cardById);
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    triggerDownload(blob, `${deck.slug}.tts.json`);
}
function downloadDeckJson(deck, slots, cardById) {
    const obj = {
        deck: {
            id: deck.id,
            name: deck.name,
            slug: deck.slug,
            format: deck.format,
            description: deck.description,
        },
        main: slots
            .filter((s) => !s.sideboard)
            .map((s) => ({ name: cardById.get(s.cardId)?.name, slug: cardById.get(s.cardId)?.slug, quantity: s.quantity })),
        sideboard: slots
            .filter((s) => s.sideboard)
            .map((s) => ({ name: cardById.get(s.cardId)?.name, slug: cardById.get(s.cardId)?.slug, quantity: s.quantity })),
    };
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    triggerDownload(blob, `${deck.slug}.deck.json`);
}
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
