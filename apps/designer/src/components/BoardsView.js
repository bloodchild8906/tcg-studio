import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
/**
 * Boards view (sec 26).
 *
 * Two modes mirroring the deck view:
 *   • Browse — grid of board tiles (mini playmat preview).
 *   • Edit   — drag-drop zone designer with a property inspector.
 *
 * Why we don't use Konva for the board canvas (unlike the card type
 * designer): board zones are simple rectangles. SVG handles drag/resize
 * just as well at this scale, with cleaner accessibility, and it
 * avoids loading another Konva instance for a separate workspace.
 *
 * The board canvas is laid out in design-pixel space (e.g. 1920×1080)
 * and scaled to fit the viewport via a CSS transform on the wrapper.
 */
export function BoardsView() {
    const project = useDesigner(selectActiveProject);
    const [boards, setBoards] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [creating, setCreating] = useState(false);
    const refresh = useCallback(async () => {
        if (!project) {
            setBoards([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setBoards(await api.listBoards({ projectId: project.id }));
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
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950", children: _jsx("p", { className: "text-sm text-ink-400", children: "Pick a project to manage its boards." }) }));
    }
    if (editingId) {
        return (_jsx(BoardDesigner, { boardId: editingId, onClose: () => {
                setEditingId(null);
                void refresh();
            } }));
    }
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-6xl p-6", children: [_jsxs("header", { className: "mb-5 flex items-end justify-between", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: ["Project: ", project.name] }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Boards" }), _jsxs("p", { className: "mt-1 text-xs text-ink-400", children: [boards.length, " board", boards.length === 1 ? "" : "s", " \u00B7 play areas with named zones for playtest."] })] }), _jsx("button", { type: "button", onClick: () => setCreating(true), className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25", children: "+ New board" })] }), error && (_jsx("div", { className: "mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500", children: error })), creating && (_jsx(NewBoardForm, { projectId: project.id, onCancel: () => setCreating(false), onCreated: (b) => {
                        setBoards((prev) => [...prev, b]);
                        setCreating(false);
                        setEditingId(b.id);
                    } })), loading && boards.length === 0 ? (_jsx("p", { className: "py-6 text-center text-sm text-ink-500", children: "Loading\u2026" })) : (_jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3", children: [boards.map((b) => (_jsxs("li", { className: "group flex flex-col rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40", children: [_jsxs("button", { type: "button", onClick: () => setEditingId(b.id), className: "flex flex-1 flex-col gap-2 p-4 text-left", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-sm font-medium text-ink-50", children: b.name }), _jsx("p", { className: "font-mono text-[10px] text-ink-500", children: b.slug })] }), _jsxs("span", { className: "rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300", children: [b.zonesJson.length, " zones"] })] }), _jsx(BoardThumb, { board: b }), _jsxs("div", { className: "mt-auto flex items-center gap-2 text-[10px] text-ink-500", children: [_jsxs("span", { children: [b.width, " \u00D7 ", b.height] }), _jsx("span", { children: "\u00B7" }), _jsx("span", { className: "capitalize", children: b.status })] })] }), _jsxs("div", { className: "flex border-t border-ink-800", children: [_jsx("button", { type: "button", onClick: () => setEditingId(b.id), className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: "Open" }), _jsx("button", { type: "button", onClick: async () => {
                                                if (!confirm(`Delete board "${b.name}"?`))
                                                    return;
                                                try {
                                                    await api.deleteBoard(b.id);
                                                    await refresh();
                                                }
                                                catch (err) {
                                                    setError(err instanceof Error ? err.message : "delete failed");
                                                }
                                            }, className: "flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500", children: "Delete" })] })] }, b.id))), !loading && boards.length === 0 && (_jsx("li", { className: "col-span-full rounded border border-dashed border-ink-700 px-3 py-10 text-center text-xs text-ink-500", children: "No boards yet \u2014 create one to define a play area." }))] }))] }) }));
}
/* ====================================================================== */
/* Tile preview                                                            */
/* ====================================================================== */
function BoardThumb({ board }) {
    // Mini SVG render of the zones at thumbnail scale. The aspect of the
    // board's design canvas drives the viewBox so different sizes (e.g.
    // landscape playmat vs portrait deck) preview at the right ratio.
    return (_jsx("div", { className: "aspect-[16/9] w-full overflow-hidden rounded border border-ink-700 bg-ink-950", children: _jsxs("svg", { viewBox: `0 0 ${board.width} ${board.height}`, preserveAspectRatio: "xMidYMid meet", className: "block h-full w-full", children: [_jsx("rect", { x: 0, y: 0, width: board.width, height: board.height, fill: board.background }), board.zonesJson.map((z) => (_jsx("g", { children: _jsx("rect", { x: z.bounds.x, y: z.bounds.y, width: z.bounds.width, height: z.bounds.height, fill: z.color ?? "rgba(212,162,76,0.08)", stroke: z.color ?? "rgba(212,162,76,0.6)", strokeWidth: 4, strokeDasharray: "14 12" }) }, z.id)))] }) }));
}
/* ====================================================================== */
/* New-board form                                                          */
/* ====================================================================== */
function NewBoardForm({ projectId, onCreated, onCancel, }) {
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [touchedSlug, setTouchedSlug] = useState(false);
    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const created = await api.createBoard({
                projectId,
                name,
                slug,
                // Seed with a sensible default 1v1 layout so the user lands on a
                // useful starting state instead of a blank canvas.
                zonesJson: defaultZones(),
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
    return (_jsxs("form", { onSubmit: submit, className: "mb-4 grid grid-cols-[1fr_220px_auto_auto] items-end gap-2 rounded border border-accent-500/40 bg-accent-500/5 p-3", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Name" }), _jsx("input", { type: "text", value: name, autoFocus: true, onChange: (e) => {
                            setName(e.target.value);
                            if (!touchedSlug)
                                setSlug(slugify(e.target.value));
                        }, placeholder: "Standard 1v1", className: "mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: "Slug" }), _jsx("input", { type: "text", value: slug, onChange: (e) => {
                            setTouchedSlug(true);
                            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
                        }, className: "mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100" })] }), _jsx("button", { type: "button", onClick: onCancel, disabled: busy, className: "rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name || !slug, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "…" : "Create" }), error && _jsx("p", { className: "col-span-full text-[11px] text-danger-500", children: error })] }));
}
/**
 * Sensible default 1v1 layout — battlefield in the middle, hand at the
 * bottom for the local player, deck/discard on the right edge.
 */
function defaultZones() {
    return [
        {
            id: "p1-battlefield",
            name: "P1 Battlefield",
            kind: "battlefield",
            bounds: { x: 80, y: 540, width: 1500, height: 280 },
            owner: "p1",
            visibility: "public",
            stackMode: "spread",
            color: "#3a4258",
        },
        {
            id: "p2-battlefield",
            name: "P2 Battlefield",
            kind: "battlefield",
            bounds: { x: 80, y: 220, width: 1500, height: 280 },
            owner: "p2",
            visibility: "public",
            stackMode: "spread",
            color: "#3a4258",
        },
        {
            id: "p1-hand",
            name: "P1 Hand",
            kind: "hand",
            bounds: { x: 80, y: 860, width: 1500, height: 180 },
            owner: "p1",
            visibility: "owner_only",
            stackMode: "spread",
            color: "#262c3d",
        },
        {
            id: "p1-deck",
            name: "P1 Deck",
            kind: "deck",
            bounds: { x: 1620, y: 540, width: 220, height: 280 },
            owner: "p1",
            visibility: "private",
            stackMode: "stacked",
            color: "#5a3e3e",
        },
        {
            id: "p1-discard",
            name: "P1 Discard",
            kind: "discard",
            bounds: { x: 1620, y: 860, width: 220, height: 180 },
            owner: "p1",
            visibility: "public",
            stackMode: "stacked",
            color: "#3a3a3e",
        },
        {
            id: "p2-deck",
            name: "P2 Deck",
            kind: "deck",
            bounds: { x: 1620, y: 220, width: 220, height: 280 },
            owner: "p2",
            visibility: "private",
            stackMode: "stacked",
            color: "#5a3e3e",
        },
        {
            id: "p2-discard",
            name: "P2 Discard",
            kind: "discard",
            bounds: { x: 1620, y: 40, width: 220, height: 160 },
            owner: "p2",
            visibility: "public",
            stackMode: "stacked",
            color: "#3a3a3e",
        },
    ];
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
/* Designer                                                                */
/* ====================================================================== */
function BoardDesigner({ boardId, onClose }) {
    const [board, setBoard] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [savedTick, setSavedTick] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void api
            .getBoard(boardId)
            .then((b) => !cancelled && setBoard(b))
            .catch((err) => {
            if (cancelled)
                return;
            setError(err instanceof Error ? err.message : "load failed");
        });
        return () => {
            cancelled = true;
        };
    }, [boardId]);
    async function persist(patch) {
        if (!board)
            return;
        try {
            const updated = await api.updateBoard(board.id, patch);
            setBoard(updated);
            setSavedTick(true);
            setTimeout(() => setSavedTick(false), 1200);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
    }
    function patchZones(updater) {
        if (!board)
            return;
        const next = updater(board.zonesJson);
        setBoard({ ...board, zonesJson: next });
    }
    async function saveZones() {
        if (!board)
            return;
        setBusy(true);
        setError(null);
        try {
            const updated = await api.updateBoard(board.id, {
                zonesJson: board.zonesJson,
                width: board.width,
                height: board.height,
                background: board.background,
            });
            setBoard(updated);
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
    function addZone() {
        if (!board)
            return;
        const cx = board.width / 2;
        const cy = board.height / 2;
        const id = `zone-${Math.random().toString(36).slice(2, 7)}`;
        const next = {
            id,
            name: "New zone",
            kind: "custom",
            bounds: { x: cx - 150, y: cy - 100, width: 300, height: 200 },
            owner: "shared",
            visibility: "public",
            stackMode: "spread",
            color: "#3a4258",
        };
        patchZones((zs) => [...zs, next]);
        setSelectedId(id);
    }
    function deleteZone(id) {
        patchZones((zs) => zs.filter((z) => z.id !== id));
        if (selectedId === id)
            setSelectedId(null);
    }
    if (!board) {
        return (_jsx("div", { className: "flex h-full items-center justify-center bg-ink-950 text-sm text-ink-500", children: error ?? "Loading board…" }));
    }
    const selected = board.zonesJson.find((z) => z.id === selectedId) ?? null;
    return (_jsxs("div", { className: "grid grid-cols-[1fr_320px] overflow-hidden", children: [_jsxs("main", { className: "flex flex-col overflow-hidden bg-ink-950", children: [_jsxs("header", { className: "flex items-center justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { type: "button", onClick: onClose, className: "text-[11px] text-ink-400 hover:text-ink-100", children: "\u2190 Boards" }), _jsx("h1", { className: "text-base font-semibold text-ink-50", children: board.name }), _jsxs("span", { className: "rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300", children: [board.zonesJson.length, " zones"] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [savedTick && _jsx("span", { className: "text-[11px] text-emerald-300", children: "Saved." }), error && _jsx("span", { className: "text-[11px] text-danger-500", children: error }), _jsx("button", { type: "button", onClick: addZone, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700", children: "+ Zone" }), _jsx("button", { type: "button", onClick: saveZones, disabled: busy, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "Saving…" : "Save board" })] })] }), _jsx(BoardCanvas, { board: board, selectedId: selectedId, onSelect: setSelectedId, onZonePatch: (id, patch) => patchZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z))) })] }), _jsxs("aside", { className: "overflow-y-auto border-l border-ink-700 bg-ink-900 p-4", children: [_jsxs(Section, { title: "Board", children: [_jsx(Field, { label: "Name", children: _jsx(Input, { value: board.name, onCommit: (v) => persist({ name: v }) }) }), _jsx(Field, { label: "Status", children: _jsx("select", { value: board.status, onChange: (e) => persist({ status: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["draft", "active", "archived"].map((s) => (_jsx("option", { value: s, children: s }, s))) }) }), _jsx(Field, { label: "Background", hint: "Hex color (e.g. #1a1d2a).", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: board.background, onChange: (e) => setBoard({ ...board, background: e.target.value }), className: "h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900" }), _jsx(Input, { value: board.background, onCommit: (v) => setBoard({ ...board, background: v }) })] }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Width", children: _jsx(NumberInput, { value: board.width, onCommit: (v) => setBoard({ ...board, width: Math.max(64, Math.min(8192, v)) }) }) }), _jsx(Field, { label: "Height", children: _jsx(NumberInput, { value: board.height, onCommit: (v) => setBoard({ ...board, height: Math.max(64, Math.min(8192, v)) }) }) })] })] }), _jsx(Section, { title: selected ? "Zone" : "Zones", children: selected ? (_jsx(ZoneInspector, { zone: selected, onPatch: (patch) => patchZones((zs) => zs.map((z) => (z.id === selected.id ? { ...z, ...patch } : z))), onDelete: () => deleteZone(selected.id) })) : (_jsxs("ul", { className: "space-y-1", children: [board.zonesJson.map((z) => (_jsxs("li", { onClick: () => setSelectedId(z.id), className: "flex cursor-pointer items-center gap-2 rounded border border-ink-800 bg-ink-950/40 px-2 py-1 text-xs hover:border-ink-700 hover:bg-ink-800", children: [_jsx("span", { className: "inline-block h-3 w-3 rounded", style: { background: z.color ?? "#3a4258" }, "aria-hidden": "true" }), _jsx("span", { className: "truncate text-ink-100", children: z.name }), _jsx("span", { className: "ml-auto rounded bg-ink-800 px-1 py-0.5 font-mono text-[9px] uppercase text-ink-400", children: z.kind }), _jsx("span", { className: "rounded bg-ink-800 px-1 py-0.5 font-mono text-[9px] uppercase text-ink-400", children: z.owner })] }, z.id))), board.zonesJson.length === 0 && (_jsx("li", { className: "rounded border border-dashed border-ink-700 px-2 py-3 text-center text-[11px] text-ink-500", children: "No zones \u2014 click + Zone in the toolbar." }))] })) })] })] }));
}
/* ====================================================================== */
/* Canvas                                                                  */
/* ====================================================================== */
function BoardCanvas({ board, selectedId, onSelect, onZonePatch, }) {
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
    // Compute the scale that fits the design canvas inside the visible
    // viewport. The board renders at its native pixel dimensions in SVG;
    // this just sets the SVG element's CSS size to land at the right
    // physical size. Drag math converts client px → board px via this
    // scale on each pointer move.
    const scale = useMemo(() => {
        if (box.w === 0 || box.h === 0)
            return 1;
        return Math.min(box.w / board.width, box.h / board.height);
    }, [box, board.width, board.height]);
    function startDrag(zoneId, mode) {
        return (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.currentTarget;
            target.setPointerCapture?.(e.pointerId);
            const zone = board.zonesJson.find((z) => z.id === zoneId);
            if (!zone)
                return;
            const startX = e.clientX;
            const startY = e.clientY;
            const start = { ...zone.bounds };
            function onMove(ev) {
                const dx = (ev.clientX - startX) / scale;
                const dy = (ev.clientY - startY) / scale;
                let nb = { ...start };
                if (mode === "move") {
                    nb.x = clamp(start.x + dx, 0, board.width - start.width);
                    nb.y = clamp(start.y + dy, 0, board.height - start.height);
                }
                else {
                    // Resize from a corner — clamp so we don't invert dimensions.
                    if (mode === "nw" || mode === "sw") {
                        nb.x = clamp(start.x + dx, 0, start.x + start.width - 20);
                        nb.width = start.width - (nb.x - start.x);
                    }
                    if (mode === "ne" || mode === "se") {
                        nb.width = clamp(start.width + dx, 20, board.width - start.x);
                    }
                    if (mode === "nw" || mode === "ne") {
                        nb.y = clamp(start.y + dy, 0, start.y + start.height - 20);
                        nb.height = start.height - (nb.y - start.y);
                    }
                    if (mode === "sw" || mode === "se") {
                        nb.height = clamp(start.height + dy, 20, board.height - start.y);
                    }
                }
                // Round to whole pixels — keeps the saved JSON readable and
                // avoids accumulating floating-point dust over many drags.
                nb = {
                    x: Math.round(nb.x),
                    y: Math.round(nb.y),
                    width: Math.round(nb.width),
                    height: Math.round(nb.height),
                };
                onZonePatch(zoneId, { bounds: nb });
            }
            function onUp() {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            }
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        };
    }
    return (_jsx("div", { ref: wrapRef, className: "relative flex flex-1 items-center justify-center overflow-hidden p-6", onClick: () => onSelect(null), children: _jsxs("svg", { viewBox: `0 0 ${board.width} ${board.height}`, preserveAspectRatio: "xMidYMid meet", style: {
                width: board.width * scale,
                height: board.height * scale,
            }, className: "rounded-lg border border-ink-700 shadow-2xl", children: [_jsx("rect", { x: 0, y: 0, width: board.width, height: board.height, fill: board.background }), board.zonesJson.map((z) => {
                    const sel = z.id === selectedId;
                    return (_jsxs("g", { children: [_jsx("rect", { x: z.bounds.x, y: z.bounds.y, width: z.bounds.width, height: z.bounds.height, fill: z.color ?? "rgba(212,162,76,0.08)", stroke: sel ? "#d4a24c" : (z.color ?? "rgba(212,162,76,0.6)"), strokeWidth: sel ? 4 : 2, strokeDasharray: sel ? undefined : "12 8", onPointerDown: (e) => {
                                    e.stopPropagation();
                                    onSelect(z.id);
                                    startDrag(z.id, "move")(e);
                                }, onClick: (e) => e.stopPropagation(), style: { cursor: "move" } }), _jsx("text", { x: z.bounds.x + 12, y: z.bounds.y + 28, fill: "rgba(255,255,255,0.7)", fontSize: Math.max(14, Math.min(28, z.bounds.height * 0.08)), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", pointerEvents: "none", children: z.name }), _jsxs("text", { x: z.bounds.x + 12, y: z.bounds.y + z.bounds.height - 14, fill: "rgba(255,255,255,0.4)", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", pointerEvents: "none", children: [z.kind, " \u00B7 ", z.owner, " \u00B7 ", z.visibility] }), sel && (_jsxs(_Fragment, { children: [_jsx(ResizeHandle, { x: z.bounds.x, y: z.bounds.y, cursor: "nw-resize", onDown: startDrag(z.id, "nw") }), _jsx(ResizeHandle, { x: z.bounds.x + z.bounds.width, y: z.bounds.y, cursor: "ne-resize", onDown: startDrag(z.id, "ne") }), _jsx(ResizeHandle, { x: z.bounds.x, y: z.bounds.y + z.bounds.height, cursor: "sw-resize", onDown: startDrag(z.id, "sw") }), _jsx(ResizeHandle, { x: z.bounds.x + z.bounds.width, y: z.bounds.y + z.bounds.height, cursor: "se-resize", onDown: startDrag(z.id, "se") })] }))] }, z.id));
                })] }) }));
}
function ResizeHandle({ x, y, cursor, onDown, }) {
    const size = 12;
    return (_jsx("rect", { x: x - size / 2, y: y - size / 2, width: size, height: size, fill: "#d4a24c", stroke: "#1a1d2a", strokeWidth: 1, style: { cursor }, onPointerDown: onDown }));
}
/* ====================================================================== */
/* Zone inspector                                                          */
/* ====================================================================== */
function ZoneInspector({ zone, onPatch, onDelete, }) {
    return (_jsxs("div", { className: "space-y-3", children: [_jsx(Field, { label: "Name", children: _jsx(Input, { value: zone.name, onCommit: (v) => onPatch({ name: v }) }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Kind", children: _jsx("select", { value: zone.kind, onChange: (e) => onPatch({ kind: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: [
                                "deck",
                                "hand",
                                "discard",
                                "exile",
                                "battlefield",
                                "resource",
                                "command",
                                "sideboard",
                                "shared",
                                "token",
                                "custom",
                            ].map((k) => (_jsx("option", { value: k, children: k }, k))) }) }), _jsx(Field, { label: "Owner", children: _jsx("select", { value: zone.owner, onChange: (e) => onPatch({ owner: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["p1", "p2", "shared"].map((k) => (_jsx("option", { value: k, children: k }, k))) }) })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Visibility", children: _jsx("select", { value: zone.visibility, onChange: (e) => onPatch({ visibility: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["public", "private", "owner_only"].map((k) => (_jsx("option", { value: k, children: k.replace("_", " ") }, k))) }) }), _jsx(Field, { label: "Stack mode", children: _jsx("select", { value: zone.stackMode, onChange: (e) => onPatch({ stackMode: e.target.value }), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: ["stacked", "spread", "row", "grid", "fan"].map((k) => (_jsx("option", { value: k, children: k }, k))) }) })] }), _jsx(Field, { label: "Color", hint: "Hex; tints the zone's background.", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: zone.color ?? "#3a4258", onChange: (e) => onPatch({ color: e.target.value }), className: "h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900" }), _jsx(Input, { value: zone.color ?? "", onCommit: (v) => onPatch({ color: v || undefined }) })] }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "X", children: _jsx(NumberInput, { value: zone.bounds.x, onCommit: (v) => onPatch({ bounds: { ...zone.bounds, x: v } }) }) }), _jsx(Field, { label: "Y", children: _jsx(NumberInput, { value: zone.bounds.y, onCommit: (v) => onPatch({ bounds: { ...zone.bounds, y: v } }) }) }), _jsx(Field, { label: "W", children: _jsx(NumberInput, { value: zone.bounds.width, onCommit: (v) => onPatch({ bounds: { ...zone.bounds, width: Math.max(20, v) } }) }) }), _jsx(Field, { label: "H", children: _jsx(NumberInput, { value: zone.bounds.height, onCommit: (v) => onPatch({ bounds: { ...zone.bounds, height: Math.max(20, v) } }) }) })] }), _jsx("button", { type: "button", onClick: onDelete, className: "rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20", children: "Delete zone" })] }));
}
/* ====================================================================== */
/* Bits                                                                    */
/* ====================================================================== */
function Section({ title, children, }) {
    return (_jsxs("section", { className: "mb-4 space-y-3 rounded border border-ink-700 bg-ink-900/40 p-3", children: [_jsx("h3", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: title }), children] }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function Input({ value, onCommit }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (_jsx("input", { type: "text", value: draft, onChange: (e) => setDraft(e.target.value), onBlur: () => {
            if (draft !== value)
                onCommit(draft);
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }));
}
function NumberInput({ value, onCommit, }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (_jsx("input", { type: "number", value: draft, onChange: (e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n))
                setDraft(n);
        }, onBlur: () => {
            if (draft !== value)
                onCommit(Math.round(draft));
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100" }));
}
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
