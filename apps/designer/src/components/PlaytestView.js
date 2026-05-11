import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
export function PlaytestView() {
    const project = useDesigner(selectActiveProject);
    const [boards, setBoards] = useState([]);
    const [decks, setDecks] = useState([]);
    const [chosenBoardId, setChosenBoardId] = useState("");
    const [chosenDeckP1, setChosenDeckP1] = useState("");
    const [chosenDeckP2, setChosenDeckP2] = useState("");
    const [session, setSession] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!project)
            return;
        let cancelled = false;
        void Promise.all([
            api.listBoards({ projectId: project.id }),
            api.listDecks({ projectId: project.id }),
        ])
            .then(([b, d]) => {
            if (cancelled)
                return;
            setBoards(b);
            setDecks(d);
        })
            .catch((err) => {
            if (cancelled)
                return;
            setError(err instanceof Error ? err.message : "load failed");
        });
        return () => {
            cancelled = true;
        };
    }, [project]);
    async function startSession() {
        if (!chosenBoardId || !chosenDeckP1) {
            setError("Pick a board and at least P1's deck.");
            return;
        }
        setError(null);
        try {
            const [board, p1Deck, p2Deck] = await Promise.all([
                api.getBoard(chosenBoardId),
                api.getDeck(chosenDeckP1),
                chosenDeckP2 ? api.getDeck(chosenDeckP2) : Promise.resolve(null),
            ]);
            const next = newSession(board, p1Deck, p2Deck);
            setSession(next);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "couldn't start session");
        }
    }
    if (!project) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to start a playtest." }) }));
    }
    if (!session) {
        return (_jsx("div", { className: "overflow-y-auto bg-ink-950 p-8", children: _jsxs("div", { className: "mx-auto max-w-2xl", children: [_jsxs("header", { className: "mb-6", children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-2xl font-semibold text-ink-50", children: "Playtest" }), _jsx("p", { className: "mt-1 text-sm text-ink-400", children: "Pick a board layout and the decks for each seat. The engine seeds the deck zones with the deck contents, shuffled. No multiplayer or networked sync \u2014 both seats run locally." })] }), error && (_jsx("div", { className: "mb-4 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), _jsxs("div", { className: "space-y-4 rounded border border-ink-700 bg-ink-900 p-4", children: [_jsx(Field, { label: "Board layout", children: _jsxs("select", { value: chosenBoardId, onChange: (e) => setChosenBoardId(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: [_jsx("option", { value: "", children: "\u2014 Pick \u2014" }), boards.map((b) => (_jsxs("option", { value: b.id, children: [b.name, " (", b.zonesJson.length, " zones)"] }, b.id)))] }) }), _jsx(Field, { label: "P1 deck", children: _jsxs("select", { value: chosenDeckP1, onChange: (e) => setChosenDeckP1(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: [_jsx("option", { value: "", children: "\u2014 Pick \u2014" }), decks.map((d) => (_jsxs("option", { value: d.id, children: [d.name, " (", d.cardCount ?? 0, " slots)"] }, d.id)))] }) }), _jsx(Field, { label: "P2 deck (optional)", children: _jsxs("select", { value: chosenDeckP2, onChange: (e) => setChosenDeckP2(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: [_jsx("option", { value: "", children: "\u2014 Solo / no opponent \u2014" }), decks.map((d) => (_jsxs("option", { value: d.id, children: [d.name, " (", d.cardCount ?? 0, " slots)"] }, d.id)))] }) }), _jsx("button", { type: "button", onClick: startSession, disabled: !chosenBoardId || !chosenDeckP1, className: "w-full rounded border border-accent-500/40 bg-accent-500/15 px-3 py-2 text-sm font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: "Start session" })] }), boards.length === 0 && (_jsx("p", { className: "mt-4 text-[11px] text-ink-500", children: "No boards yet \u2014 head to the Boards view to create one." })), decks.length === 0 && (_jsx("p", { className: "mt-2 text-[11px] text-ink-500", children: "No decks yet \u2014 build one in the Decks view." }))] }) }));
    }
    return (_jsx(PlaytestSession, { session: session, setSession: setSession, onExit: () => setSession(null) }));
}
function Field({ label, children }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children] }));
}
/* ====================================================================== */
/* Session                                                                 */
/* ====================================================================== */
/**
 * Build a fresh Session from a board + 0–2 loaded decks.
 *
 * Heuristic: for each seat, we expand the deck's slots into PlayCards
 * (one per quantity), assign each card to the first deck-kind zone
 * owned by that seat, then shuffle.
 */
function newSession(board, p1Deck, p2Deck) {
    const cards = [];
    const cardById = new Map();
    let nextId = 1;
    function seedSeat(seat, deck) {
        if (!deck)
            return;
        // Find the first deck zone owned by this seat. Future enhancement:
        // honor `metadataJson.startingZone` overrides on the deck.
        const deckZone = board.zonesJson.find((z) => z.kind === "deck" && z.owner === seat);
        if (!deckZone)
            return;
        const slots = (deck.cards ?? []).filter((c) => !c.sideboard);
        const expanded = [];
        for (const s of slots) {
            const card = s.card;
            if (card) {
                cardById.set(card.id, card);
            }
            for (let q = 0; q < s.quantity; q++) {
                expanded.push({
                    id: `pc-${nextId++}`,
                    cardId: s.cardId,
                    owner: seat,
                    zoneId: deckZone.id,
                    index: 0, // assigned after shuffle
                    tapped: false,
                    faceDown: false,
                });
            }
        }
        shuffle(expanded);
        expanded.forEach((c, i) => (c.index = i));
        cards.push(...expanded);
    }
    seedSeat("p1", p1Deck);
    seedSeat("p2", p2Deck);
    return {
        board,
        cards,
        cardById,
        log: [`Session started — ${cards.length} cards loaded.`],
        life: { p1: 20, p2: 20 },
        nextId,
    };
}
/** Fisher–Yates in-place shuffle. */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
/* ====================================================================== */
/* Session UI                                                              */
/* ====================================================================== */
function PlaytestSession({ session, setSession, onExit, }) {
    const [draggingCardId, setDraggingCardId] = useState(null);
    const wrapRef = useRef(null);
    const [box, setBox] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = wrapRef.current;
        if (!el)
            return;
        function measure() {
            if (!el)
                return;
            const r = el.getBoundingClientRect();
            setBox({ w: r.width, h: r.height });
        }
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const scale = useMemo(() => {
        if (box.w === 0 || box.h === 0)
            return 1;
        return Math.min(box.w / session.board.width, box.h / session.board.height);
    }, [box, session.board.width, session.board.height]);
    // ----- mutations -----
    const log = useCallback((msg) => {
        setSession({ ...session, log: [...session.log, msg].slice(-200) });
    }, [session, setSession]);
    function moveCard(cardId, toZoneId, toEnd = true) {
        const card = session.cards.find((c) => c.id === cardId);
        if (!card)
            return;
        const fromZoneId = card.zoneId;
        const fromZone = session.board.zonesJson.find((z) => z.id === fromZoneId);
        const toZone = session.board.zonesJson.find((z) => z.id === toZoneId);
        // Re-index: remove from source, append to dest.
        const next = session.cards.map((c) => ({ ...c }));
        const movedIdx = next.findIndex((c) => c.id === cardId);
        if (movedIdx < 0)
            return;
        const moved = next[movedIdx];
        moved.zoneId = toZoneId;
        moved.index = toEnd
            ? next.filter((c) => c.zoneId === toZoneId).length
            : 0;
        // Untap on hand → battlefield is a common reset; players can override.
        if (toZone?.kind === "hand")
            moved.tapped = false;
        // Compact source indexes so ordering stays sane.
        const sourceCards = next
            .filter((c) => c.zoneId === fromZoneId)
            .sort((a, b) => a.index - b.index);
        sourceCards.forEach((c, i) => (c.index = i));
        setSession({ ...session, cards: next });
        log(`Moved ${cardLabel(session, card)} from ${fromZone?.name ?? "?"} → ${toZone?.name ?? "?"}.`);
    }
    function drawFromZone(zoneId) {
        const zone = session.board.zonesJson.find((z) => z.id === zoneId);
        if (!zone)
            return;
        const cardsInZone = session.cards
            .filter((c) => c.zoneId === zoneId)
            .sort((a, b) => b.index - a.index); // top of the deck = highest index
        const top = cardsInZone[0];
        if (!top) {
            log(`${zone.name} is empty — can't draw.`);
            return;
        }
        // Find the matching hand zone for this seat.
        const handZone = session.board.zonesJson.find((z) => z.kind === "hand" && z.owner === zone.owner);
        if (!handZone) {
            log(`No hand zone for ${zone.owner}.`);
            return;
        }
        moveCard(top.id, handZone.id, true);
    }
    function shuffleZone(zoneId) {
        const zone = session.board.zonesJson.find((z) => z.id === zoneId);
        if (!zone)
            return;
        const next = session.cards.map((c) => ({ ...c }));
        const inZone = next.filter((c) => c.zoneId === zoneId);
        const newOrder = shuffle([...inZone]);
        // Reassign indexes based on the shuffled order.
        newOrder.forEach((c, i) => {
            const src = next.find((n) => n.id === c.id);
            if (src)
                src.index = i;
        });
        setSession({ ...session, cards: next });
        log(`Shuffled ${zone.name} (${inZone.length} cards).`);
    }
    function toggleTap(cardId) {
        const next = session.cards.map((c) => c.id === cardId ? { ...c, tapped: !c.tapped } : c);
        setSession({ ...session, cards: next });
        const card = session.cards.find((c) => c.id === cardId);
        if (card)
            log(`${cardLabel(session, card)} ${card.tapped ? "untapped" : "tapped"}.`);
    }
    function adjustLife(seat, delta) {
        setSession({
            ...session,
            life: { ...session.life, [seat]: session.life[seat] + delta },
            log: [...session.log, `${seat.toUpperCase()} life ${delta > 0 ? "+" : ""}${delta} → ${session.life[seat] + delta}`].slice(-200),
        });
    }
    function startCardDrag(cardId) {
        return (e) => {
            e.stopPropagation();
            setDraggingCardId(cardId);
            // Actual drop is detected by the zone hover handler below using
            // a ref-based pointer position check at pointerup time.
            const onUp = (ev) => {
                // Find the zone under the pointer in board-local coords.
                const localPt = clientToBoardCoord(wrapRef.current, ev.clientX, ev.clientY, scale, session.board);
                if (localPt) {
                    const target = session.board.zonesJson.find((z) => localPt.x >= z.bounds.x &&
                        localPt.x <= z.bounds.x + z.bounds.width &&
                        localPt.y >= z.bounds.y &&
                        localPt.y <= z.bounds.y + z.bounds.height);
                    if (target) {
                        const card = session.cards.find((c) => c.id === cardId);
                        if (card && card.zoneId !== target.id) {
                            moveCard(cardId, target.id);
                        }
                    }
                }
                setDraggingCardId(null);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointerup", onUp);
        };
    }
    return (_jsxs("div", { className: "grid grid-cols-[1fr_300px] overflow-hidden", children: [_jsxs("main", { className: "flex flex-col overflow-hidden bg-ink-950", children: [_jsxs("header", { className: "flex items-center justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { type: "button", onClick: onExit, className: "text-[11px] text-ink-400 hover:text-ink-100", children: "\u2190 End session" }), _jsx("h1", { className: "text-base font-semibold text-ink-50", children: session.board.name })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(LifeCounter, { label: "P1", value: session.life.p1, onAdjust: (d) => adjustLife("p1", d) }), _jsx(LifeCounter, { label: "P2", value: session.life.p2, onAdjust: (d) => adjustLife("p2", d) })] })] }), _jsx("div", { ref: wrapRef, className: "relative flex flex-1 items-center justify-center overflow-hidden p-4", children: _jsxs("svg", { viewBox: `0 0 ${session.board.width} ${session.board.height}`, preserveAspectRatio: "xMidYMid meet", style: {
                                width: session.board.width * scale,
                                height: session.board.height * scale,
                            }, className: "rounded-lg border border-ink-700 shadow-2xl", children: [_jsx("rect", { x: 0, y: 0, width: session.board.width, height: session.board.height, fill: session.board.background }), session.board.zonesJson.map((zone) => (_jsx(ZoneSvg, { zone: zone, session: session, draggingCardId: draggingCardId, onZoneClick: (z) => {
                                        if (z.kind === "deck")
                                            drawFromZone(z.id);
                                    }, onZoneShuffle: (z) => shuffleZone(z.id), onCardClick: (c, e) => {
                                        if (e.shiftKey)
                                            toggleTap(c.id);
                                    }, onCardDragStart: startCardDrag, onCardRightClick: (c) => toggleTap(c.id) }, zone.id)))] }) })] }), _jsxs("aside", { className: "flex flex-col overflow-hidden border-l border-ink-700 bg-ink-900", children: [_jsxs("header", { className: "border-b border-ink-700 px-3 py-3", children: [_jsx("h2", { className: "text-sm font-medium text-ink-50", children: "Game log" }), _jsx("p", { className: "text-[10px] text-ink-500", children: "Click a deck to draw \u00B7 drag cards between zones \u00B7 shift-click to tap \u00B7 right-click for tap." })] }), _jsx("ul", { className: "flex-1 overflow-y-auto p-3 text-[11px] text-ink-300", children: session.log
                            .slice()
                            .reverse()
                            .map((entry, i) => (_jsx("li", { className: "border-b border-ink-800 px-1 py-1 last:border-0", children: entry }, `${i}-${entry.slice(0, 16)}`))) })] })] }));
}
function LifeCounter({ label, value, onAdjust, }) {
    return (_jsxs("div", { className: "flex items-center gap-1 rounded border border-ink-700 bg-ink-900 px-2 py-1", children: [_jsx("span", { className: "text-[10px] uppercase tracking-wider text-ink-400", children: label }), _jsx("button", { type: "button", onClick: () => onAdjust(-1), className: "px-1 text-ink-300 hover:text-ink-100", children: "\u2212" }), _jsx("span", { className: "w-6 text-center text-sm font-semibold tabular-nums text-ink-100", children: value }), _jsx("button", { type: "button", onClick: () => onAdjust(1), className: "px-1 text-ink-300 hover:text-ink-100", children: "+" })] }));
}
/* ====================================================================== */
/* Zone rendering                                                          */
/* ====================================================================== */
function ZoneSvg({ zone, session, draggingCardId, onZoneClick, onZoneShuffle, onCardClick, onCardDragStart, onCardRightClick, }) {
    const cardsInZone = useMemo(() => session.cards
        .filter((c) => c.zoneId === zone.id)
        .sort((a, b) => a.index - b.index), [session.cards, zone.id]);
    // Lay out cards within the zone according to its stack mode.
    // Stacked: pile up at zone origin with a small offset per card.
    // Spread / row: distribute horizontally, capped to zone width.
    const cardW = Math.min(zone.bounds.width / 4, 180);
    const cardH = cardW * 1.4;
    const positions = useMemo(() => {
        const out = [];
        if (zone.stackMode === "stacked") {
            for (let i = 0; i < cardsInZone.length; i++) {
                out.push({
                    x: zone.bounds.x + 8 + Math.min(i, 6),
                    y: zone.bounds.y + 8 + Math.min(i, 6),
                    w: cardW,
                    h: cardH,
                });
            }
        }
        else {
            // spread / row / etc — distribute along the zone width.
            const innerW = Math.max(0, zone.bounds.width - 16);
            const step = cardsInZone.length > 1 ? Math.min(cardW + 6, innerW / cardsInZone.length) : 0;
            for (let i = 0; i < cardsInZone.length; i++) {
                out.push({
                    x: zone.bounds.x + 8 + i * step,
                    y: zone.bounds.y + (zone.bounds.height - cardH) / 2,
                    w: cardW,
                    h: cardH,
                });
            }
        }
        return out;
    }, [cardsInZone, zone.bounds.x, zone.bounds.y, zone.bounds.width, zone.bounds.height, zone.stackMode, cardW, cardH]);
    // For "private" / "owner_only" zones we hide card faces — only the
    // owner sees what's there. In a single-screen MVP both seats share
    // the screen, so hiding doesn't add real privacy; it does make the
    // visual difference between hand and battlefield clear.
    const facedown = zone.visibility === "private" ||
        (zone.visibility === "owner_only" && zone.kind === "deck");
    return (_jsxs("g", { children: [_jsx("rect", { x: zone.bounds.x, y: zone.bounds.y, width: zone.bounds.width, height: zone.bounds.height, fill: zone.color ?? "rgba(0,0,0,0.2)", stroke: "rgba(212,162,76,0.3)", strokeWidth: 2, strokeDasharray: "14 12", onClick: () => onZoneClick(zone), style: { cursor: zone.kind === "deck" ? "pointer" : "default" } }), _jsx("text", { x: zone.bounds.x + 12, y: zone.bounds.y + 28, fill: "rgba(255,255,255,0.7)", fontSize: Math.max(14, Math.min(28, zone.bounds.height * 0.07)), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", pointerEvents: "none", children: zone.name }), _jsx("text", { x: zone.bounds.x + zone.bounds.width - 12, y: zone.bounds.y + 28, fill: "rgba(255,255,255,0.5)", fontSize: 14, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textAnchor: "end", pointerEvents: "none", children: cardsInZone.length }), (zone.kind === "deck" || zone.kind === "discard") && cardsInZone.length > 1 && (_jsxs("g", { onClick: (e) => {
                    e.stopPropagation();
                    onZoneShuffle(zone);
                }, style: { cursor: "pointer" }, children: [_jsx("rect", { x: zone.bounds.x + zone.bounds.width - 86, y: zone.bounds.y + 8, width: 70, height: 22, rx: 4, fill: "rgba(0,0,0,0.4)", stroke: "rgba(212,162,76,0.6)" }), _jsx("text", { x: zone.bounds.x + zone.bounds.width - 51, y: zone.bounds.y + 24, fill: "#d4a24c", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textAnchor: "middle", pointerEvents: "none", children: "shuffle" })] })), cardsInZone.map((c, i) => {
                const pos = positions[i];
                if (!pos)
                    return null;
                const card = session.cardById.get(c.cardId);
                const isDragging = c.id === draggingCardId;
                return (_jsxs("g", { transform: c.tapped ? `rotate(90 ${pos.x + pos.w / 2} ${pos.y + pos.h / 2})` : undefined, opacity: isDragging ? 0.4 : 1, onPointerDown: (e) => {
                        if (e.button !== 0)
                            return;
                        onCardDragStart(c.id)(e);
                    }, onClick: (e) => {
                        e.stopPropagation();
                        onCardClick(c, e);
                    }, onContextMenu: (e) => {
                        e.preventDefault();
                        onCardRightClick(c);
                    }, style: { cursor: "grab" }, children: [_jsx("rect", { x: pos.x, y: pos.y, width: pos.w, height: pos.h, rx: 6, fill: facedown ? "#1a1d2a" : "#262c3d", stroke: "#d4a24c", strokeWidth: 1.5 }), !facedown && card && (_jsx("text", { x: pos.x + 8, y: pos.y + 22, fill: "#ebd198", fontSize: Math.max(11, pos.w * 0.08), fontFamily: "serif", pointerEvents: "none", children: truncate(card.name, Math.floor(pos.w / 8)) })), facedown && (_jsx("text", { x: pos.x + pos.w / 2, y: pos.y + pos.h / 2 + 4, fill: "rgba(212,162,76,0.4)", fontSize: pos.w * 0.18, fontFamily: "serif", fontStyle: "italic", textAnchor: "middle", pointerEvents: "none", children: "?" })), c.tapped && !facedown && (_jsx("circle", { cx: pos.x + pos.w - 12, cy: pos.y + pos.h - 12, r: 6, fill: "#d4a24c" }))] }, c.id));
            })] }));
}
/* ====================================================================== */
/* Helpers                                                                 */
/* ====================================================================== */
function clientToBoardCoord(wrap, clientX, clientY, scale, board) {
    if (!wrap)
        return null;
    const r = wrap.getBoundingClientRect();
    // The SVG is centered inside the wrap (object-contain via our scale
    // calc). Compute its bounding box and translate from there.
    const svgW = board.width * scale;
    const svgH = board.height * scale;
    const ox = (r.width - svgW) / 2;
    const oy = (r.height - svgH) / 2;
    const x = (clientX - r.left - ox) / scale;
    const y = (clientY - r.top - oy) / scale;
    if (x < 0 || y < 0 || x > board.width || y > board.height)
        return null;
    return { x, y };
}
function cardLabel(session, c) {
    const card = session.cardById.get(c.cardId);
    return card?.name ?? `card ${c.cardId.slice(0, 6)}`;
}
function truncate(s, n) {
    if (s.length <= n)
        return s;
    return `${s.slice(0, Math.max(1, n - 1))}…`;
}
