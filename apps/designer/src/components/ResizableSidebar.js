import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
/**
 * A side panel with a draggable inner edge and a collapse toggle.
 *
 * Used for the designer's left (LayerTree + CardData) and right
 * (Inspector + Validation) panes. Dragging the inner edge resizes the
 * panel within `[minWidth, maxWidth]`; clicking the chevron collapses
 * it to a thin bar; double-clicking the drag handle also collapses.
 *
 * State (width + collapsed) persists per-`storageKey` to localStorage so
 * the user's layout survives reloads.
 *
 * Why pixel widths over CSS percentages: card design canvases get tight
 * around 1280px monitors. A user who's set the inspector to 280px wants
 * exactly 280px back, not "33% of whatever the window is now".
 */
export function ResizableSidebar({ side, storageKey, defaultWidth = 280, minWidth = 200, maxWidth = 600, collapsedWidth = 28, collapsedLabel, children, }) {
    const [width, setWidth] = useState(() => {
        if (typeof window === "undefined")
            return defaultWidth;
        const saved = window.localStorage.getItem(`${storageKey}.width`);
        const n = saved ? Number.parseInt(saved, 10) : NaN;
        return Number.isFinite(n) ? clamp(n, minWidth, maxWidth) : defaultWidth;
    });
    const [collapsed, setCollapsed] = useState(() => {
        if (typeof window === "undefined")
            return false;
        return window.localStorage.getItem(`${storageKey}.collapsed`) === "true";
    });
    // Persist state. Cheap to write; the delay is dominated by the browser
    // microtask queue, not actual disk IO, so no debounce needed for typical
    // drag rates.
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        window.localStorage.setItem(`${storageKey}.width`, String(width));
    }, [storageKey, width]);
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        window.localStorage.setItem(`${storageKey}.collapsed`, String(collapsed));
    }, [storageKey, collapsed]);
    // Latest width / clamps captured per-drag so the listener closures don't
    // see stale state during rapid pointer movement.
    const dragRef = useRef(null);
    function startDrag(e) {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { startX: e.clientX, startW: width };
        function onMove(ev) {
            const ctx = dragRef.current;
            if (!ctx)
                return;
            // For a left panel, dragging right increases width; for a right
            // panel, dragging left increases width. Sign flip handles that.
            const dx = side === "left" ? ev.clientX - ctx.startX : ctx.startX - ev.clientX;
            setWidth(clamp(ctx.startW + dx, minWidth, maxWidth));
        }
        function onUp() {
            dragRef.current = null;
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }
    if (collapsed) {
        return (_jsxs("aside", { className: [
                "flex h-full flex-col flex-shrink-0 items-center gap-2 bg-ink-900 py-2",
                side === "left" ? "border-r border-ink-700" : "border-l border-ink-700",
            ].join(" "), style: { width: collapsedWidth }, children: [_jsx("button", { type: "button", onClick: () => setCollapsed(false), title: "Expand panel", className: "rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: side === "left" ? _jsx(ChevronRight, {}) : _jsx(ChevronLeft, {}) }), collapsedLabel && (_jsx("span", { className: "select-none text-[10px] uppercase tracking-widest text-ink-500", style: {
                        writingMode: "vertical-rl",
                        transform: side === "left" ? undefined : "rotate(180deg)",
                    }, children: collapsedLabel }))] }));
    }
    return (_jsxs("aside", { className: [
            "relative h-full flex-shrink-0 bg-ink-900",
            side === "left" ? "border-r border-ink-700" : "border-l border-ink-700",
        ].join(" "), style: { width }, children: [_jsx("button", { type: "button", onClick: () => setCollapsed(true), title: "Collapse panel", className: [
                    "absolute top-1 z-10 rounded p-1 text-ink-500 opacity-60 hover:bg-ink-800 hover:text-ink-100 hover:opacity-100",
                    side === "left" ? "right-2" : "left-2",
                ].join(" "), children: side === "left" ? _jsx(ChevronLeft, {}) : _jsx(ChevronRight, {}) }), _jsx("div", { className: "h-full", children: children }), _jsx("div", { onPointerDown: startDrag, onDoubleClick: () => setCollapsed(true), title: "Drag to resize, double-click to collapse", className: [
                    "absolute top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-accent-500/40",
                    side === "left" ? "right-0 -mr-0.5" : "left-0 -ml-0.5",
                ].join(" ") })] }));
}
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
function ChevronLeft() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "2", children: _jsx("path", { d: "M10 4 L6 8 L10 12" }) }));
}
function ChevronRight() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "2", children: _jsx("path", { d: "M6 4 L10 8 L6 12" }) }));
}
