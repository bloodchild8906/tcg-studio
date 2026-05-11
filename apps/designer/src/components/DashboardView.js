import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { selectActiveCardType, selectActiveProject, useDesigner, } from "@/store/designerStore";
import * as api from "@/lib/api";
/**
 * Dashboard view — the home page of the studio.
 *
 * Cheap to render, opinionated about what an early-stage card game studio
 * cares about most:
 *   • Which project am I in.
 *   • Quick stat cards: # card types, # cards, # assets coming soon.
 *   • Big shortcut tiles to the next thing they're going to do.
 *   • A short "what to try next" prompt — keeps the surface explorable
 *     without bloating into a Notion-style empty state.
 *
 * The dashboard never holds editing state — it's purely navigational. Every
 * action either flips `view` or selects a card type before flipping.
 */
export function DashboardView() {
    const project = useDesigner(selectActiveProject);
    const cardType = useDesigner(selectActiveCardType);
    const cardTypes = useDesigner((s) => s.cardTypes);
    const cards = useDesigner((s) => s.cards);
    const setView = useDesigner((s) => s.setView);
    // Load secondary counters lazily — these aren't in the central store
    // (it's intentionally lean) so we just probe the count endpoints when
    // the dashboard is open. One-shot per project change is fine.
    const [counts, setCounts] = useState({
        sets: 0,
        blocks: 0,
        factions: 0,
        keywords: 0,
        lore: 0,
        assets: 0,
        decks: 0,
    });
    useEffect(() => {
        if (!project) {
            setCounts({ sets: 0, blocks: 0, factions: 0, keywords: 0, lore: 0, assets: 0, decks: 0 });
            return;
        }
        let cancelled = false;
        void Promise.all([
            api.listSets({ projectId: project.id }).catch(() => []),
            api.listBlocks({ projectId: project.id }).catch(() => []),
            api.listFactions({ projectId: project.id }).catch(() => []),
            api.listKeywords({ projectId: project.id }).catch(() => []),
            api.listLore({ projectId: project.id }).catch(() => []),
            api.listAssets({ projectId: project.id }).catch(() => []),
            api.listDecks({ projectId: project.id }).catch(() => []),
        ]).then(([sets, blocks, factions, keywords, lore, assets, decks]) => {
            if (cancelled)
                return;
            setCounts({
                sets: sets.length,
                blocks: blocks.length,
                factions: factions.length,
                keywords: keywords.length,
                lore: lore.length,
                assets: assets.length,
                decks: decks.length,
            });
        });
        return () => {
            cancelled = true;
        };
    }, [project]);
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-5xl p-8", children: [_jsxs("header", { className: "mb-8", children: [_jsx("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: project ? `Project: ${project.name}` : "No project selected" }), _jsx("h1", { className: "mt-1 text-2xl font-semibold text-ink-50", children: "Dashboard" }), _jsx("p", { className: "mt-1 text-sm text-ink-400", children: project
                                ? "Pick where to dive in. Card types define layout & schema; cards fill that schema with content."
                                : "Connect to the API or create a project to get started." })] }), _jsxs("section", { className: "grid grid-cols-2 gap-3 md:grid-cols-4", children: [_jsx(StatCard, { label: "Card types", value: cardTypes.length, onClick: () => setView("card_types") }), _jsx(StatCard, { label: "Cards", value: cards.length, onClick: () => setView("cards") }), _jsx(StatCard, { label: "Sets", value: counts.sets, onClick: () => setView("sets") }), _jsx(StatCard, { label: "Blocks", value: counts.blocks, onClick: () => setView("sets"), hint: "Manage in the Sets view" })] }), _jsxs("section", { className: "mt-3 grid grid-cols-2 gap-3 md:grid-cols-4", children: [_jsx(StatCard, { label: "Factions", value: counts.factions, onClick: () => setView("factions") }), _jsx(StatCard, { label: "Keywords", value: counts.keywords, onClick: () => setView("rules") }), _jsx(StatCard, { label: "Lore", value: counts.lore, onClick: () => setView("lore") }), _jsx(StatCard, { label: "Decks", value: counts.decks, onClick: () => setView("decks") })] }), _jsx("section", { className: "mt-3 grid grid-cols-2 gap-3 md:grid-cols-4", children: _jsx(StatCard, { label: "Assets", value: counts.assets, onClick: () => setView("assets") }) }), _jsxs("section", { className: "mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3", children: [_jsx(ShortcutTile, { title: "Card types", description: "Browse and create card types. Each defines a layout, schema, and variants.", cta: `Open (${cardTypes.length})`, onClick: () => setView("card_types"), disabled: !project, accent: true }), _jsx(ShortcutTile, { title: "Card type designer", description: cardType
                                ? `Continue editing "${cardType.name}".`
                                : "Edit a card type's layout, layers, and variant rules.", cta: cardType ? "Open designer" : "Pick a card type", onClick: () => setView(cardType ? "designer" : "card_types"), disabled: !project }), _jsx(ShortcutTile, { title: "Cards", description: cardType
                                ? `Author cards under "${cardType.name}" — schema-driven form.`
                                : "Pick a card type to see its cards.", cta: "Open cards", onClick: () => setView(cardType ? "cards" : "card_types"), disabled: !project })] }), _jsxs("section", { className: "mt-10", children: [_jsx("h2", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: "Up next" }), _jsxs("ul", { className: "mt-3 space-y-1.5 text-xs text-ink-400", children: [_jsx("li", { children: "\u2022 Public card gallery \u2014 browse + share released cards (sec 15)." }), _jsx("li", { children: "\u2022 Ability graph designer (sec 24)." }), _jsx("li", { children: "\u2022 Board layout designer + manual playtest (sec 26 + 30)." }), _jsx("li", { children: "\u2022 CMS page builder + public sites (sec 14)." }), _jsx("li", { children: "\u2022 Plugin SDK + marketplace (sec 34\u201335)." })] })] })] }) }));
}
function StatCard({ label, value, onClick, hint, }) {
    // Clickable stat cards become navigation shortcuts. Non-clickable
    // ones (project status etc.) render as a static div so the cursor
    // stays accurate.
    const className = "block w-full rounded-lg border border-ink-700 bg-ink-900 p-4 text-left transition-colors";
    const interactive = onClick
        ? `${className} hover:border-ink-600 hover:bg-ink-800`
        : className;
    const inner = (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-[10px] uppercase tracking-wider text-ink-500", children: label }), _jsx("p", { className: "mt-1 text-2xl font-semibold text-ink-50", children: value }), hint && _jsx("p", { className: "mt-1 text-[10px] text-ink-500", children: hint })] }));
    return onClick ? (_jsx("button", { type: "button", onClick: onClick, className: interactive, children: inner })) : (_jsx("div", { className: className, children: inner }));
}
function ShortcutTile({ title, description, cta, onClick, disabled, accent, }) {
    return (_jsxs("button", { type: "button", onClick: onClick, disabled: disabled, className: [
            "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
            accent
                ? "border-accent-500/40 bg-accent-500/5 hover:border-accent-500/70 hover:bg-accent-500/10"
                : "border-ink-700 bg-ink-900 hover:border-ink-600 hover:bg-ink-800",
            disabled && "cursor-not-allowed opacity-40",
        ]
            .filter(Boolean)
            .join(" "), children: [_jsx("h3", { className: "text-sm font-medium text-ink-50", children: title }), _jsx("p", { className: "text-xs text-ink-400", children: description }), _jsxs("span", { className: [
                    "mt-auto inline-flex items-center gap-1 text-[11px] font-medium",
                    accent ? "text-accent-300" : "text-ink-300",
                ].join(" "), children: [cta, " \u2192"] })] }));
}
