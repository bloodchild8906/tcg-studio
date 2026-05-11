import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
/**
 * Asset editor modal.
 *
 * Edits asset-level metadata: name, type, visibility, and 9-slice insets.
 * The blob itself is immutable — re-uploading is the only way to change
 * the bytes. Saving PATCHes /api/v1/assets/:id and calls onSaved with the
 * fresh row so the parent grid can update.
 *
 * Why a modal here too: the AssetsView is a grid; opening per-tile edit
 * inline would either tear up the layout or cram a tiny form into a 200px
 * tile. A modal gives the user breathing room to dial in slice insets.
 */
export function AssetEditor({ asset, open, onClose, onSaved, }) {
    const [name, setName] = useState("");
    const [type, setType] = useState("art");
    const [visibility, setVisibility] = useState("private");
    const [sliceEnabled, setSliceEnabled] = useState(false);
    const [slice, setSlice] = useState({ top: 24, right: 24, bottom: 24, left: 24 });
    // Pixels-per-unit (PPU): how many source pixels equal one logical unit
    // when the asset is consumed by a layer or print export. Mirrors Unity's
    // sprite import setting — useful for pixel art (e.g. PPU=16 means a
    // 16×16 sprite is 1 unit tall, so card layers can size by units rather
    // than chasing texture dimensions every time the source changes).
    // Stored in metadataJson.pixelsPerUnit; absent / 0 means "unset".
    const [ppuEnabled, setPpuEnabled] = useState(false);
    const [pixelsPerUnit, setPixelsPerUnit] = useState(100);
    // Natural dimensions are surfaced from SliceImagePreview; we keep them
    // here too so the PPU section can show "X × Y units" without having to
    // re-decode the image. The preview component sets them via the
    // `onNaturalSize` callback below.
    const [natural, setNatural] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    // Reset when modal opens with a new asset.
    useEffect(() => {
        if (!open || !asset)
            return;
        setName(asset.name);
        setType(asset.type);
        setVisibility(asset.visibility);
        setError(null);
        const meta = asset.metadataJson ?? {};
        const m = meta.slice;
        if (m) {
            setSliceEnabled(true);
            setSlice({
                top: Number(m.top) || 0,
                right: Number(m.right) || 0,
                bottom: Number(m.bottom) || 0,
                left: Number(m.left) || 0,
            });
        }
        else {
            setSliceEnabled(false);
            setSlice({ top: 24, right: 24, bottom: 24, left: 24 });
        }
        const storedPpu = Number(meta.pixelsPerUnit);
        if (Number.isFinite(storedPpu) && storedPpu > 0) {
            setPpuEnabled(true);
            setPixelsPerUnit(storedPpu);
        }
        else {
            setPpuEnabled(false);
            setPixelsPerUnit(100);
        }
        setNatural(null);
    }, [open, asset]);
    if (!open || !asset)
        return null;
    async function save() {
        if (!asset)
            return;
        setBusy(true);
        setError(null);
        try {
            // Merge new slice config into existing metadata so we don't drop fields
            // we don't know about (license, tags, etc.).
            const nextMetadata = { ...(asset.metadataJson ?? {}) };
            if (sliceEnabled) {
                nextMetadata.slice = slice;
            }
            else {
                delete nextMetadata.slice;
            }
            if (ppuEnabled && pixelsPerUnit > 0) {
                nextMetadata.pixelsPerUnit = pixelsPerUnit;
            }
            else {
                delete nextMetadata.pixelsPerUnit;
            }
            const updated = await api.updateAsset(asset.id, {
                name,
                type,
                visibility,
                metadataJson: nextMetadata,
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
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": `Edit ${asset.name}`, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !busy)
                onClose();
        }, children: _jsxs("div", { className: "flex h-[80vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-start justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-50", children: "Edit asset" }), _jsx("p", { className: "font-mono text-[11px] text-ink-500", children: asset.id })] }), _jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4", children: [_jsxs("div", { className: "grid grid-cols-[220px_1fr] gap-4", children: [_jsx(SliceImagePreview, { src: api.assetBlobUrl(asset.id), slice: slice, onSliceChange: setSlice, editable: sliceEnabled, onNaturalSize: setNatural }), _jsxs("div", { className: "space-y-3", children: [_jsx(Field, { label: "Name", children: _jsx(Input, { value: name, onChange: setName }) }), _jsx(Field, { label: "Type", hint: "frame, art, icon, panel, font, \u2026", children: _jsx(Input, { value: type, onChange: setType }) }), _jsx(Field, { label: "Visibility", children: _jsx(Select, { value: visibility, options: ["private", "tenant_internal", "project_internal", "public"], onChange: setVisibility }) }), _jsx(Field, { label: "Mime / size", children: _jsxs("p", { className: "text-xs text-ink-300", children: [asset.mimeType, " \u00B7 ", asset.fileSize.toLocaleString(), " B"] }) })] })] }), _jsxs("section", { className: "mt-6 rounded border border-ink-700 bg-ink-900/40 p-3", children: [_jsx(Toggle, { label: "9-slice frame", checked: sliceEnabled, onChange: setSliceEnabled }), _jsx("p", { className: "mt-1 text-[11px] text-ink-500", children: "When enabled, image layers picking this asset auto-apply the slice insets so the corners stay crisp at any size." }), sliceEnabled && (_jsxs("div", { className: "mt-3 grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Top (px)", children: _jsx(NumberInput, { value: slice.top, onChange: (v) => setSlice({ ...slice, top: v }) }) }), _jsx(Field, { label: "Right (px)", children: _jsx(NumberInput, { value: slice.right, onChange: (v) => setSlice({ ...slice, right: v }) }) }), _jsx(Field, { label: "Bottom (px)", children: _jsx(NumberInput, { value: slice.bottom, onChange: (v) => setSlice({ ...slice, bottom: v }) }) }), _jsx(Field, { label: "Left (px)", children: _jsx(NumberInput, { value: slice.left, onChange: (v) => setSlice({ ...slice, left: v }) }) })] }))] }), _jsxs("section", { className: "mt-4 rounded border border-ink-700 bg-ink-900/40 p-3", children: [_jsx(Toggle, { label: "Pixels per unit", checked: ppuEnabled, onChange: setPpuEnabled }), _jsx("p", { className: "mt-1 text-[11px] text-ink-500", children: "How many source pixels equal one logical unit. Pixel art often uses 16, 32, or 64; high-res art typically 100. Layers and exports can size by units instead of texture pixels." }), ppuEnabled && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mt-3 grid grid-cols-[140px_1fr] items-end gap-3", children: [_jsx(Field, { label: "PPU", children: _jsx(NumberInput, { value: pixelsPerUnit, onChange: (v) => setPixelsPerUnit(Math.max(1, v)) }) }), _jsx(Field, { label: "Size in units", children: _jsx("p", { className: "font-mono text-xs text-ink-300", children: natural && pixelsPerUnit > 0
                                                            ? `${(natural.w / pixelsPerUnit).toFixed(2)} × ${(natural.h / pixelsPerUnit).toFixed(2)} u`
                                                            : "—" }) })] }), _jsx("div", { className: "mt-2 flex flex-wrap gap-1.5", children: [16, 32, 64, 100, 128].map((preset) => (_jsx("button", { type: "button", onClick: () => setPixelsPerUnit(preset), className: [
                                                    "rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                                                    pixelsPerUnit === preset
                                                        ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                                                        : "border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600 hover:bg-ink-800",
                                                ].join(" "), children: preset }, preset))) })] }))] })] }), error && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: error })), _jsxs("footer", { className: "flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-3", children: [_jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "button", onClick: save, disabled: busy, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: busy ? "Saving…" : "Save" })] })] }) }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function Input({ value, onChange }) {
    return (_jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function NumberInput({ value, onChange, }) {
    return (_jsx("input", { type: "number", min: 0, value: value, onChange: (e) => {
            const v = e.target.value;
            if (v === "")
                return;
            const n = Number(v);
            if (!Number.isNaN(n))
                onChange(Math.max(0, Math.round(n)));
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function Select({ value, options, onChange, }) {
    return (_jsx("select", { value: value, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40", children: options.map((o) => (_jsx("option", { value: o, children: o }, o))) }));
}
/**
 * Visual 9-slice editor.
 *
 * Renders the image with an SVG overlay and four draggable guide lines —
 * one per inset (top/right/bottom/left). Dragging a guide updates the
 * corresponding slice value in image-space pixels (always relative to the
 * image's natural dimensions, never the displayed size).
 *
 * Why image-space: the preview is shown at whatever CSS size fits the
 * column, but the slice metadata is consumed elsewhere (CardRender,
 * Konva) at the source resolution. Storing in pixels of the original
 * image makes the values portable.
 *
 * If editable is false (slice toggle off) the overlay still draws the
 * current slice values as a faint hint, but pointer interaction is
 * disabled.
 */
function SliceImagePreview({ src, slice, onSliceChange, editable, onNaturalSize, }) {
    // Natural dimensions of the source image — used to convert screen-space
    // drag deltas into image-space pixels for the slice insets.
    const [natural, setNatural] = useState(null);
    // The SVG matches the displayed image bounding box exactly. We track its
    // size so the per-edge handle hit areas can be computed correctly.
    const [box, setBox] = useState({ w: 0, h: 0 });
    const wrapRef = useRef(null);
    const imgRef = useRef(null);
    // Re-measure on load and on resize. ResizeObserver beats window resize
    // because the modal can grow/shrink without the window changing (e.g.
    // when the user opens the dev tools split horizontally).
    useEffect(() => {
        const img = imgRef.current;
        if (!img)
            return;
        function measure() {
            if (!img)
                return;
            const r = img.getBoundingClientRect();
            setBox({ w: r.width, h: r.height });
        }
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(img);
        return () => ro.disconnect();
    }, [natural]);
    function onLoad(e) {
        const t = e.currentTarget;
        const next = { w: t.naturalWidth, h: t.naturalHeight };
        setNatural(next);
        onNaturalSize?.(next);
    }
    // Drag a handle. Edge-name semantics:
    //   • top    — vertical Y position from top of image (px)
    //   • bottom — vertical inset from bottom (px). We store as inset, but
    //              drag math uses absolute Y and converts on commit.
    //   • left   — horizontal X position from left (px)
    //   • right  — horizontal inset from right (px)
    function startDrag(edge) {
        return (e) => {
            if (!editable || !natural)
                return;
            e.preventDefault();
            e.stopPropagation();
            const target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            // Snapshot at drag start so the math stays stable as the user moves
            // — repeated reads from `slice` would race because state updates
            // within a drag aren't synchronous.
            const start = { ...slice };
            const startX = e.clientX;
            const startY = e.clientY;
            const scaleX = natural.w / box.w;
            const scaleY = natural.h / box.h;
            function onMove(ev) {
                const dxPx = (ev.clientX - startX) * scaleX;
                const dyPx = (ev.clientY - startY) * scaleY;
                const next = { ...start };
                if (edge === "top") {
                    // Drag down increases top inset; clamp so it can't pass the
                    // bottom edge (leaves at least 1px of center).
                    next.top = clampInset(start.top + dyPx, 0, natural.h - start.bottom - 1);
                }
                else if (edge === "bottom") {
                    // Drag down DECREASES the bottom inset (the line moves away
                    // from the bottom edge of the image).
                    next.bottom = clampInset(start.bottom - dyPx, 0, natural.h - start.top - 1);
                }
                else if (edge === "left") {
                    next.left = clampInset(start.left + dxPx, 0, natural.w - start.right - 1);
                }
                else if (edge === "right") {
                    next.right = clampInset(start.right - dxPx, 0, natural.w - start.left - 1);
                }
                onSliceChange(next);
            }
            function onUp() {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            }
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        };
    }
    // Image-space pixel positions of each guide → screen-space positions
    // for SVG drawing. Falls back to 0 until natural dimensions are known.
    const guideTopY = natural ? (slice.top / natural.h) * box.h : 0;
    const guideBottomY = natural ? box.h - (slice.bottom / natural.h) * box.h : 0;
    const guideLeftX = natural ? (slice.left / natural.w) * box.w : 0;
    const guideRightX = natural ? box.w - (slice.right / natural.w) * box.w : 0;
    const cursor = editable ? "" : "default";
    const guideStroke = editable ? "rgba(212,162,76,0.95)" : "rgba(212,162,76,0.45)";
    const handleFill = editable ? "rgba(212,162,76,0.18)" : "transparent";
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { ref: wrapRef, className: "relative overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:14px_14px]", style: { aspectRatio: "1 / 1" }, children: [_jsx("img", { ref: imgRef, src: src, alt: "", onLoad: onLoad, className: "absolute inset-0 m-auto max-h-full max-w-full object-contain", draggable: false }), natural && box.w > 0 && box.h > 0 && (_jsxs("svg", { 
                        // Position absolutely over the displayed image bounds. The
                        // image is centered in the square via object-contain, so we
                        // compute its top/left offset from the wrapper to align.
                        className: "pointer-events-none absolute", style: {
                            left: `calc(50% - ${box.w / 2}px)`,
                            top: `calc(50% - ${box.h / 2}px)`,
                            width: box.w,
                            height: box.h,
                        }, viewBox: `0 0 ${box.w} ${box.h}`, children: [_jsx("rect", { x: guideLeftX, y: guideTopY, width: Math.max(0, guideRightX - guideLeftX), height: Math.max(0, guideBottomY - guideTopY), fill: "none", stroke: guideStroke, strokeDasharray: "5 4", strokeWidth: 1 }), _jsx("line", { x1: 0, y1: guideTopY, x2: box.w, y2: guideTopY, stroke: guideStroke, strokeWidth: 1 }), _jsx("line", { x1: 0, y1: guideBottomY, x2: box.w, y2: guideBottomY, stroke: guideStroke, strokeWidth: 1 }), _jsx("line", { x1: guideLeftX, y1: 0, x2: guideLeftX, y2: box.h, stroke: guideStroke, strokeWidth: 1 }), _jsx("line", { x1: guideRightX, y1: 0, x2: guideRightX, y2: box.h, stroke: guideStroke, strokeWidth: 1 }), _jsx("rect", { x: 0, y: guideTopY - 6, width: box.w, height: 12, fill: handleFill, style: {
                                    cursor: editable ? "ns-resize" : cursor,
                                    pointerEvents: editable ? "auto" : "none",
                                }, onPointerDown: startDrag("top") }), _jsx("rect", { x: 0, y: guideBottomY - 6, width: box.w, height: 12, fill: handleFill, style: {
                                    cursor: editable ? "ns-resize" : cursor,
                                    pointerEvents: editable ? "auto" : "none",
                                }, onPointerDown: startDrag("bottom") }), _jsx("rect", { x: guideLeftX - 6, y: 0, width: 12, height: box.h, fill: handleFill, style: {
                                    cursor: editable ? "ew-resize" : cursor,
                                    pointerEvents: editable ? "auto" : "none",
                                }, onPointerDown: startDrag("left") }), _jsx("rect", { x: guideRightX - 6, y: 0, width: 12, height: box.h, fill: handleFill, style: {
                                    cursor: editable ? "ew-resize" : cursor,
                                    pointerEvents: editable ? "auto" : "none",
                                }, onPointerDown: startDrag("right") })] }))] }), _jsxs("p", { className: "text-[10px] text-ink-500", children: [natural
                        ? `${natural.w} × ${natural.h} px`
                        : "Loading image…", editable && natural ? " · Drag the dashed lines to set insets." : ""] })] }));
}
function clampInset(v, min, max) {
    if (Number.isNaN(v))
        return min;
    return Math.max(min, Math.min(max, Math.round(v)));
}
function Toggle({ label, checked, onChange, }) {
    return (_jsxs("label", { className: "flex items-center gap-2 text-xs text-ink-100", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked), className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { children: label })] }));
}
