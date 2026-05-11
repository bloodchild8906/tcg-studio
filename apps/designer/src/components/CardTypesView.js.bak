import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import { CardTypeThumbnail } from "@/components/CardPreview";
/**
 * Card Types view — the home grid.
 *
 * Shows every card type in the active project as a tile. Click a tile to
 * open the Card Type Designer for that type. The "+ New" tile creates a card
 * type via the API and immediately switches to the designer with a starter
 * template loaded — the user's first Save persists it as a real template.
 *
 * Layout:
 *   ┌───────┬───────┬───────┬───────┐
 *   │  + new│ tile  │ tile  │ tile  │
 *   └───────┴───────┴───────┴───────┘
 *
 * The "+ new" tile is first so it's reachable even when the project has many
 * card types. The new-type form is inline (no modal): less friction, and
 * card-type creation is rapid in early design.
 */
export function CardTypesView() {
    const project = useDesigner(selectActiveProject);
    const cardTypes = useDesigner((s) => s.cardTypes);
    const setView = useDesigner((s) => s.setView);
    const selectCardType = useDesigner((s) => s.selectCardType);
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-6xl p-6", children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: project ? `Project: ${project.name}` : "No project selected" }), _jsx("h1", { className: "text-xl font-semibold text-ink-50", children: "Card types" }), _jsx("p", { className: "mt-1 text-xs text-ink-400", children: "Each card type defines a layout, schema, and variants. Click one to open the designer." })] }), _jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3", children: [_jsx(NewCardTypeTile, {}), cardTypes.map((c) => (_jsx(CardTypeTile, { cardType: c, onOpen: () => {
                                void selectCardType(c.id);
                                setView("designer");
                            }, onOpenCards: () => {
                                void selectCardType(c.id);
                                setView("cards");
                            } }, c.id)))] }), cardTypes.length === 0 && (_jsx("p", { className: "mt-6 text-sm text-ink-500", children: "No card types yet \u2014 create your first one above." }))] }) }));
}
function CardTypeTile({ cardType, onOpen, onOpenCards, }) {
    const fieldsCount = (() => {
        const fields = cardType.schemaJson?.fields;
        return Array.isArray(fields) ? fields.length : 0;
    })();
    const hasTemplate = cardType.activeTemplateId !== null;
    return (_jsxs("li", { className: "group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40", children: [_jsxs("button", { type: "button", onClick: onOpen, className: "flex flex-1 flex-col items-start gap-2 p-4 text-left", children: [_jsxs("div", { className: "flex w-full items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-sm font-medium text-ink-50", children: cardType.name }), _jsx("p", { className: "truncate font-mono text-[10px] text-ink-500", children: cardType.slug })] }), _jsx(StatusPill, { status: cardType.status })] }), _jsx(CardTypePreview, { cardType: cardType, hasTemplate: hasTemplate }), _jsxs("div", { className: "mt-auto flex items-center gap-2 text-[10px] text-ink-500", children: [_jsxs("span", { children: [fieldsCount, " field", fieldsCount === 1 ? "" : "s"] }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: hasTemplate ? "has template" : "no template" })] })] }), _jsxs("div", { className: "flex border-t border-ink-800", children: [_jsx(TileAction, { onClick: onOpen, children: "Designer" }), _jsx(TileAction, { onClick: onOpenCards, children: "Cards" })] })] }));
}
function CardTypePreview({ cardType, hasTemplate, }) {
    // When the card type has a real template (or matches the active editor
    // template), render via CardTypeThumbnail. For untemplated card types
    // we still show the sample as a hint of what the layout *could* look
    // like, with a small overlay so the user knows it's a placeholder.
    return (_jsxs("div", { className: "relative w-full overflow-hidden rounded border border-ink-800 bg-ink-950/40", children: [_jsx(CardTypeThumbnail, { cardType: cardType }), !hasTemplate && (_jsx("div", { className: "pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-ink-950/85 via-ink-950/40 to-transparent p-2", children: _jsx("span", { className: "rounded bg-ink-900/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-400", children: "Untemplated \u00B7 sample shown" }) }))] }));
}
function StatusPill({ status }) {
    const map = {
        draft: "border-ink-700 bg-ink-800 text-ink-400",
        review: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        released: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        deprecated: "border-ink-700 bg-ink-800 text-ink-500",
        archived: "border-ink-700 bg-ink-800 text-ink-600",
    };
    return (_jsx("span", { className: `shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${map[status] ?? map.draft}`, children: status }));
}
function TileAction({ children, onClick, }) {
    return (_jsx("button", { type: "button", onClick: onClick, className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: children }));
}
/* ---------------------------------------------------------------------- */
/* + new tile                                                             */
/* ---------------------------------------------------------------------- */
function NewCardTypeTile() {
    const project = useDesigner(selectActiveProject);
    const createCardType = useDesigner((s) => s.createCardType);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [busy, setBusy] = useState(false);
    function autoSlug(n) {
        return n
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }
    async function submit(e) {
        e.preventDefault();
        if (!project || !name.trim())
            return;
        setBusy(true);
        try {
            await createCardType({
                name: name.trim(),
                slug: (slug.trim() || autoSlug(name)) || "type",
            });
            setName("");
            setSlug("");
            setOpen(false);
        }
        finally {
            setBusy(false);
        }
    }
    if (!open) {
        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setOpen(true), disabled: !project, className: "flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-40", children: [_jsx(PlusIcon, {}), _jsx("span", { className: "text-xs font-medium", children: "New card type" }), _jsx("span", { className: "text-[10px] text-ink-500", children: "Character, Spell, Source, \u2026" })] }) }));
    }
    return (_jsx("li", { children: _jsxs("form", { onSubmit: submit, className: "flex aspect-[5/7] w-full flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3", children: [_jsx("p", { className: "text-[10px] uppercase tracking-wider text-accent-300", children: "New card type" }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Name" }), _jsx("input", { type: "text", value: name, onChange: (e) => {
                                setName(e.target.value);
                                if (!slug)
                                    setSlug(autoSlug(e.target.value));
                            }, placeholder: "Spell", autoFocus: true, className: "mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Slug" }), _jsx("input", { type: "text", value: slug, onChange: (e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-")), placeholder: "spell", className: "mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-100" })] }), _jsx("p", { className: "text-[10px] text-ink-500", children: "Creates the card type, then opens the designer with a starter template." }), _jsxs("div", { className: "mt-auto flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setOpen(false), className: "flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name.trim(), className: "flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40", children: busy ? "Creating…" : "Create" })] })] }) }));
}
function PlusIcon() {
    return (_jsx("svg", { className: "h-6 w-6", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M12 5v14M5 12h14" }) }));
}
