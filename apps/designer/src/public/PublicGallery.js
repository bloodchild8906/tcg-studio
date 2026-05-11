import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPublicCard, fetchPublicCards, fetchPublicFactions, fetchPublicSets, publicAssetUrl, } from "@/public/publicApi";
import { CardRender } from "@/components/CardRender";
/**
 * Public read-only card gallery (sec 15).
 *
 * Mounts pre-auth: anyone visiting `/public/:tenantSlug` lands here, no
 * login required. The gallery hits the public API endpoints to render a
 * tenant's released cards with the same SVG renderer the designer uses.
 *
 * Routes:
 *   /public/:tenantSlug                     → grid + filters
 *   /public/:tenantSlug/cards/:cardSlug    → card detail
 *
 * URL state is owned by the browser (history.pushState). We parse on
 * mount + on every popstate. For the small number of states the gallery
 * has, a tiny route-by-pathname switcher is plenty — no need for a full
 * router dependency.
 */
export function PublicGallery({ tenantSlug }) {
    const [route, setRoute] = useState(parseRoute(tenantSlug));
    useEffect(() => {
        const onPop = () => setRoute(parseRoute(tenantSlug));
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, [tenantSlug]);
    const navigate = useCallback((next) => {
        const path = next.kind === "grid"
            ? `/public/${tenantSlug}`
            : `/public/${tenantSlug}/cards/${encodeURIComponent(next.slug)}`;
        window.history.pushState({}, "", path);
        setRoute(next);
        window.scrollTo({ top: 0 });
    }, [tenantSlug]);
    if (route.kind === "card") {
        return _jsx(PublicCardDetail, { tenantSlug: tenantSlug, cardSlug: route.slug, navigate: navigate });
    }
    return _jsx(PublicCardGrid, { tenantSlug: tenantSlug, navigate: navigate });
}
function parseRoute(tenantSlug) {
    const path = window.location.pathname;
    const expectedPrefix = `/public/${tenantSlug}`;
    const stripped = path.replace(expectedPrefix, "");
    const cardMatch = stripped.match(/^\/cards\/([^/]+)/);
    if (cardMatch)
        return { kind: "card", slug: decodeURIComponent(cardMatch[1]) };
    return { kind: "grid" };
}
/* ====================================================================== */
/* Grid                                                                    */
/* ====================================================================== */
function PublicCardGrid({ tenantSlug, navigate, }) {
    const [cards, setCards] = useState(null);
    const [tenantName, setTenantName] = useState(tenantSlug);
    const [factions, setFactions] = useState([]);
    const [sets, setSets] = useState([]);
    const [search, setSearch] = useState("");
    const [factionFilter, setFactionFilter] = useState("");
    const [setFilter, setSetFilter] = useState("");
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            fetchPublicCards(tenantSlug),
            fetchPublicSets(tenantSlug).catch(() => ({ sets: [] })),
            fetchPublicFactions(tenantSlug).catch(() => ({ factions: [] })),
        ])
            .then(([cardsRes, setsRes, factionsRes]) => {
            if (cancelled)
                return;
            // The public API casts dataJson to unknown; cast back here so
            // CardRender (which reads dataJson via Record<string, unknown>)
            // can use the shape directly.
            setCards(cardsRes.cards);
            setTenantName(cardsRes.tenant.name);
            setSets(setsRes.sets);
            setFactions(factionsRes.factions);
        })
            .catch((err) => {
            if (cancelled)
                return;
            setError(err instanceof Error ? err.message : "load failed");
        });
        return () => {
            cancelled = true;
        };
    }, [tenantSlug]);
    // Apply filters client-side. The public API supports server-side
    // filters but the gallery's responsive UX wants instant feedback as
    // the user types — fetching once and filtering in-memory is the best
    // tradeoff for the small datasets this view ships.
    const filtered = useMemo(() => {
        if (!cards)
            return [];
        const q = search.trim().toLowerCase();
        return cards.filter((c) => {
            if (setFilter && c.setId !== setFilter)
                return false;
            if (factionFilter) {
                const f = c.dataJson?.faction;
                const fs = c.dataJson?.factions;
                const matchesMono = typeof f === "string" && f === factionFilter;
                const matchesMulti = Array.isArray(fs) && fs.some((s) => s === factionFilter);
                if (!matchesMono && !matchesMulti)
                    return false;
            }
            if (q) {
                if (!c.name.toLowerCase().includes(q) &&
                    !c.slug.toLowerCase().includes(q) &&
                    !JSON.stringify(c.dataJson ?? {}).toLowerCase().includes(q)) {
                    return false;
                }
            }
            return true;
        });
    }, [cards, search, setFilter, factionFilter]);
    return (_jsxs("div", { className: "min-h-screen bg-ink-950 text-ink-100", children: [_jsx(PublicHeader, { tenantName: tenantName, subtitle: "Card gallery" }), _jsx("div", { className: "mx-auto max-w-7xl px-6 py-6", children: error ? (_jsx("div", { className: "rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })) : (_jsxs(_Fragment, { children: [_jsxs("header", { className: "mb-5 flex flex-wrap items-end gap-3", children: [_jsxs("div", { className: "flex-1", children: [_jsx("h1", { className: "text-xl font-semibold text-ink-50", children: "Cards" }), _jsx("p", { className: "mt-1 text-xs text-ink-400", children: cards === null
                                                ? "Loading…"
                                                : `${filtered.length} of ${cards.length} card${cards.length === 1 ? "" : "s"}` })] }), _jsx("input", { type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search\u2026", className: "h-9 w-56 rounded border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }), _jsxs("select", { value: setFilter, onChange: (e) => setSetFilter(e.target.value), className: "h-9 rounded border border-ink-700 bg-ink-900 px-2 text-sm text-ink-100", children: [_jsx("option", { value: "", children: "All sets" }), sets.map((s) => (_jsxs("option", { value: s.id, children: [s.code, " \u00B7 ", s.name] }, s.id)))] }), _jsxs("select", { value: factionFilter, onChange: (e) => setFactionFilter(e.target.value), className: "h-9 rounded border border-ink-700 bg-ink-900 px-2 text-sm text-ink-100", children: [_jsx("option", { value: "", children: "All factions" }), factions.map((f) => (_jsx("option", { value: f.slug, children: f.name }, f.id)))] })] }), cards === null ? (_jsx("p", { className: "py-10 text-center text-sm text-ink-500", children: "Loading cards\u2026" })) : filtered.length === 0 ? (_jsx("p", { className: "rounded border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-500", children: cards.length === 0
                                ? "No published cards yet — come back soon."
                                : "No cards match the current filters." })) : (_jsx("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4", children: filtered.map((c) => (_jsx("li", { className: "group cursor-pointer rounded-lg border border-ink-700 bg-ink-900 p-3 transition-colors hover:border-accent-500/40", onClick: () => navigate({ kind: "card", slug: c.slug }), children: _jsxs("div", { className: "flex flex-col items-center gap-2", children: [_jsx(PublicCardThumb, { tenantSlug: tenantSlug, card: c }), _jsxs("div", { className: "w-full", children: [_jsx("p", { className: "truncate text-sm font-medium text-ink-50", title: c.name, children: c.name }), _jsxs("p", { className: "truncate font-mono text-[10px] text-ink-500", children: [c.rarity ?? "—", c.collectorNumber ? ` · #${c.collectorNumber}` : ""] })] })] }) }, c.id))) }))] })) }), _jsx(PublicFooter, {})] }));
}
/* ====================================================================== */
/* Card detail                                                             */
/* ====================================================================== */
function PublicCardDetail({ tenantSlug, cardSlug, navigate, }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setData(null);
        setError(null);
        void fetchPublicCard(tenantSlug, cardSlug)
            .then((r) => !cancelled && setData(r))
            .catch((err) => {
            if (cancelled)
                return;
            setError(err instanceof Error ? err.message : "load failed");
        });
        return () => {
            cancelled = true;
        };
    }, [tenantSlug, cardSlug]);
    const tenantName = "Public gallery";
    if (error) {
        return (_jsxs("div", { className: "min-h-screen bg-ink-950 text-ink-100", children: [_jsx(PublicHeader, { tenantName: tenantName, subtitle: "Card not found" }), _jsxs("div", { className: "mx-auto max-w-3xl px-6 py-10 text-center", children: [_jsx("p", { className: "text-sm text-danger-500", children: error }), _jsx("button", { type: "button", onClick: () => navigate({ kind: "grid" }), className: "mt-4 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700", children: "\u2190 Back to gallery" })] })] }));
    }
    if (!data) {
        return (_jsx("div", { className: "min-h-screen bg-ink-950 text-ink-100", children: _jsx(PublicHeader, { tenantName: tenantName, subtitle: "Loading\u2026" }) }));
    }
    const template = parseTemplateContent(data.template?.contentJson);
    const dataJson = data.card.dataJson ?? {};
    return (_jsxs("div", { className: "min-h-screen bg-ink-950 text-ink-100", children: [_jsx(PublicHeader, { tenantName: tenantName, subtitle: data.card.name }), _jsxs("div", { className: "mx-auto grid max-w-5xl grid-cols-[auto_1fr] gap-8 px-6 py-8", children: [_jsx("div", { className: "flex justify-center", children: template ? (_jsx(CardRender, { template: template, data: dataJson, width: 400, resolveAssetId: (id) => publicAssetUrl(tenantSlug, id) })) : (_jsx("div", { className: "flex h-[560px] w-[400px] items-center justify-center rounded border border-dashed border-ink-700 text-sm text-ink-500", children: "No template available" })) }), _jsxs("div", { className: "space-y-4", children: [_jsx("button", { type: "button", onClick: () => navigate({ kind: "grid" }), className: "inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-100", children: "\u2190 Back to gallery" }), _jsx("h1", { className: "text-2xl font-semibold text-ink-50", children: data.card.name }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs text-ink-400", children: [data.card.rarity && (_jsx("span", { className: "rounded bg-ink-800 px-2 py-0.5 font-mono uppercase tracking-wider text-ink-300", children: data.card.rarity })), data.card.collectorNumber != null && (_jsxs("span", { className: "font-mono text-ink-500", children: ["#", data.card.collectorNumber] })), data.cardType?.name && _jsxs("span", { children: ["\u00B7 ", data.cardType.name] })] }), _jsx("dl", { className: "space-y-2 rounded border border-ink-700 bg-ink-900 p-4 text-xs", children: Object.entries(dataJson).map(([k, v]) => (_jsxs("div", { className: "grid grid-cols-[120px_1fr] gap-3", children: [_jsx("dt", { className: "text-[10px] uppercase tracking-wider text-ink-500", children: k }), _jsx("dd", { className: "text-ink-200", children: typeof v === "string"
                                                ? v
                                                : Array.isArray(v)
                                                    ? v.join(", ")
                                                    : v == null
                                                        ? "—"
                                                        : JSON.stringify(v) })] }, k))) })] })] }), _jsx(PublicFooter, {})] }));
}
/* ====================================================================== */
/* Bits                                                                    */
/* ====================================================================== */
/** Inline thumbnail card render — used in the grid. */
function PublicCardThumb({ tenantSlug: _tenantSlug, card }) {
    // The grid doesn't (yet) lazily fetch each card's full template. To
    // keep the listing snappy we render a simple preview tile — a colored
    // box keyed off rarity. A future enhancement: have the cards listing
    // endpoint embed a small thumbnail URL or pre-rendered tile.
    return (_jsx("div", { className: "aspect-[5/7] w-full rounded border border-ink-700 bg-ink-950 p-2 text-center", children: _jsxs("div", { className: "flex h-full w-full flex-col items-center justify-center rounded bg-gradient-to-br from-accent-500/10 to-ink-900 p-2", children: [_jsx("p", { className: "text-xs font-semibold text-accent-300", children: card.name }), _jsx("p", { className: "mt-1 font-mono text-[10px] text-ink-500", children: card.rarity ?? "" })] }) }));
}
function PublicHeader({ tenantName, subtitle }) {
    return (_jsx("header", { className: "border-b border-ink-700 bg-ink-900/80 backdrop-blur", children: _jsxs("div", { className: "mx-auto flex max-w-7xl items-center justify-between px-6 py-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] uppercase tracking-widest text-ink-500", children: tenantName }), _jsx("h1", { className: "text-lg font-semibold text-ink-50", children: subtitle })] }), _jsx("p", { className: "text-[11px] text-ink-500", children: "Powered by TCGStudio" })] }) }));
}
function PublicFooter() {
    return (_jsx("footer", { className: "mt-10 border-t border-ink-700 px-6 py-6 text-center text-[11px] text-ink-500", children: "Card data and artwork \u00A9 their respective rights holders." }));
}
/**
 * Coerce the template's `contentJson` (typed as `unknown` from the
 * public API for safety) into the `CardTypeTemplate` shape the renderer
 * expects. Returns null when the blob is missing or wrong shape.
 */
function parseTemplateContent(content) {
    if (!content || typeof content !== "object")
        return null;
    const c = content;
    if (!Array.isArray(c.layers) || !c.size || !c.size.width)
        return null;
    return c;
}
