import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
/**
 * Sprite splitter modal.
 *
 * Takes a source spritesheet asset and slices it into a grid of N rows ×
 * M cols (with optional per-cell padding/inset trimming) — each cell is
 * uploaded as its own asset under the same project. The split happens
 * client-side: we draw the original image onto an off-screen canvas, crop
 * each cell into a Blob via `canvas.toBlob`, and POST it through the
 * standard upload endpoint. No new backend route required.
 *
 * Why client-side:
 *   • the API already accepts arbitrary image uploads — adding a server
 *     splitter would duplicate decoding logic without giving us anything
 *     the browser can't do here;
 *   • the user gets a live preview of the grid before they commit;
 *   • for large sheets the round-trip cost stays predictable — N uploads,
 *     each tiny, instead of one big bytes-in-bytes-out request.
 *
 * The modal also supports trimming transparent pixels from each cell
 * before upload — useful for sprite sheets where the source padding is
 * inconsistent. We compute the bounding box of non-transparent pixels and
 * crop to that. Off by default since trimming changes the cell's
 * dimensions and may break alignment for tile-style sheets.
 */
export function SpriteSplitter({ asset, open, projectId, onClose, onSplit, }) {
    const [rows, setRows] = useState(2);
    const [cols, setCols] = useState(2);
    const [padding, setPadding] = useState(0);
    const [margin, setMargin] = useState(0);
    const [trim, setTrim] = useState(false);
    const [autoNumber, setAutoNumber] = useState(true);
    const [namePrefix, setNamePrefix] = useState("");
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [error, setError] = useState(null);
    const [natural, setNatural] = useState(null);
    const [box, setBox] = useState({ w: 0, h: 0 });
    const imgRef = useRef(null);
    // Reset whenever a new asset is opened so previous numbers don't leak.
    useEffect(() => {
        if (!open || !asset)
            return;
        setRows(2);
        setCols(2);
        setPadding(0);
        setMargin(0);
        setTrim(false);
        setAutoNumber(true);
        setNamePrefix(stripExtension(asset.name));
        setNatural(null);
        setError(null);
        setProgress({ done: 0, total: 0 });
    }, [open, asset]);
    // Re-measure displayed image size on load + resize. Mirrors the same
    // pattern used by the 9-slice editor — image-space coords are the
    // source of truth, screen-space is just for drawing the overlay.
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
    // Cell dimensions in image-space pixels. After accounting for outer
    // margin and inter-cell padding, the remaining canvas is divided
    // evenly. If the math goes negative (user typed a giant padding) we
    // clamp to 0 so the preview doesn't blow up.
    const cell = useMemo(() => {
        if (!natural)
            return { w: 0, h: 0 };
        const w = (natural.w - margin * 2 - padding * (cols - 1)) / cols;
        const h = (natural.h - margin * 2 - padding * (rows - 1)) / rows;
        return { w: Math.max(0, w), h: Math.max(0, h) };
    }, [natural, rows, cols, padding, margin]);
    if (!open || !asset)
        return null;
    async function commit() {
        if (!asset || !natural)
            return;
        if (cell.w < 1 || cell.h < 1) {
            setError("Cell size is zero — reduce padding/margin or row/column count.");
            return;
        }
        setBusy(true);
        setError(null);
        const total = rows * cols;
        setProgress({ done: 0, total });
        try {
            // Load the source as a bitmap once, then crop into each cell on a
            // shared off-screen canvas. createImageBitmap is faster than going
            // via <img> + drawImage for repeated crops because the decode
            // happens once.
            const blob = await fetchAssetBlob(asset.id);
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx)
                throw new Error("Could not get 2D canvas context");
            const created = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const sx = margin + c * (cell.w + padding);
                    const sy = margin + r * (cell.h + padding);
                    let sw = cell.w;
                    let sh = cell.h;
                    let dx = 0;
                    let dy = 0;
                    if (trim) {
                        // Find the tight bbox of non-transparent pixels by reading
                        // the cell into a probe canvas first. We trim before final
                        // draw so the output canvas matches the trimmed dimensions.
                        const probe = document.createElement("canvas");
                        probe.width = Math.round(sw);
                        probe.height = Math.round(sh);
                        const pctx = probe.getContext("2d", { willReadFrequently: true });
                        if (pctx) {
                            pctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
                            const bbox = nonTransparentBBox(pctx, probe.width, probe.height);
                            if (bbox) {
                                dx = -bbox.x;
                                dy = -bbox.y;
                                sw = bbox.w;
                                sh = bbox.h;
                                // Adjust source rect so we sample the trimmed region.
                                // sx/sy were in source coords; offset by bbox to land
                                // on the trimmed top-left.
                                // (We can't change sx/sy directly because they encode
                                // the cell origin — we only redirect the destination.)
                            }
                        }
                    }
                    canvas.width = Math.round(sw);
                    canvas.height = Math.round(sh);
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    // For trimmed cells: draw the full cell at a negative offset
                    // so only the non-transparent region lands inside the canvas.
                    if (trim && (dx !== 0 || dy !== 0)) {
                        ctx.drawImage(bitmap, sx, sy, cell.w, cell.h, dx, dy, cell.w, cell.h);
                    }
                    else {
                        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                    }
                    const cellBlob = await new Promise((resolve) => {
                        canvas.toBlob((b) => resolve(b), "image/png");
                    });
                    if (!cellBlob)
                        throw new Error(`Failed to encode cell r${r} c${c}`);
                    const idx = r * cols + c;
                    const fileName = autoNumber
                        ? `${namePrefix || "cell"}-${pad(idx + 1, total)}.png`
                        : `${namePrefix || "cell"}-r${r + 1}-c${c + 1}.png`;
                    const file = new File([cellBlob], fileName, { type: "image/png" });
                    const uploaded = await api.uploadAsset({
                        file,
                        projectId: projectId ?? undefined,
                        type: asset?.type ?? "art",
                        name: stripExtension(fileName),
                    });
                    created.push(uploaded);
                    setProgress({ done: idx + 1, total });
                }
            }
            bitmap.close?.();
            onSplit(created);
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "split failed");
        }
        finally {
            setBusy(false);
        }
    }
    // Display-space coords for the grid lines — natural-space cell math
    // is converted via the box/natural ratio so the overlay tracks the
    // displayed image exactly.
    const dispScale = natural && box.w > 0 ? box.w / natural.w : 1;
    const dispMargin = margin * dispScale;
    const dispCell = { w: cell.w * dispScale, h: cell.h * dispScale };
    const dispPadding = padding * dispScale;
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": `Split ${asset.name}`, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !busy)
                onClose();
        }, children: _jsxs("div", { className: "flex h-[85vh] w-[min(880px,94vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-start justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-50", children: "Split spritesheet" }), _jsx("p", { className: "font-mono text-[11px] text-ink-500", children: asset.name })] }), _jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsx("div", { className: "flex-1 overflow-y-auto p-4", children: _jsxs("div", { className: "grid grid-cols-[1fr_260px] gap-4", children: [_jsxs("div", { className: "relative overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:14px_14px]", style: { minHeight: 320 }, children: [_jsx("img", { ref: imgRef, src: api.assetBlobUrl(asset.id), alt: "", onLoad: (e) => setNatural({
                                            w: e.currentTarget.naturalWidth,
                                            h: e.currentTarget.naturalHeight,
                                        }), className: "absolute inset-0 m-auto max-h-full max-w-full object-contain", draggable: false }), natural && box.w > 0 && box.h > 0 && (_jsx("svg", { className: "pointer-events-none absolute", style: {
                                            left: `calc(50% - ${box.w / 2}px)`,
                                            top: `calc(50% - ${box.h / 2}px)`,
                                            width: box.w,
                                            height: box.h,
                                        }, viewBox: `0 0 ${box.w} ${box.h}`, children: Array.from({ length: rows }).flatMap((_, r) => Array.from({ length: cols }).map((_, c) => {
                                            const x = dispMargin + c * (dispCell.w + dispPadding);
                                            const y = dispMargin + r * (dispCell.h + dispPadding);
                                            return (_jsx("rect", { x: x, y: y, width: dispCell.w, height: dispCell.h, fill: "rgba(212,162,76,0.08)", stroke: "rgba(212,162,76,0.85)", strokeWidth: 1 }, `${r}-${c}`));
                                        })) }))] }), _jsxs("div", { className: "space-y-3", children: [_jsx(Field, { label: "Source size", children: _jsx("p", { className: "font-mono text-xs text-ink-300", children: natural ? `${natural.w} × ${natural.h} px` : "Loading…" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Rows", children: _jsx(NumberInput, { value: rows, min: 1, max: 64, onChange: setRows }) }), _jsx(Field, { label: "Columns", children: _jsx(NumberInput, { value: cols, min: 1, max: 64, onChange: setCols }) })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Margin (px)", hint: "Outer border ignored", children: _jsx(NumberInput, { value: margin, min: 0, max: 2048, onChange: setMargin }) }), _jsx(Field, { label: "Padding (px)", hint: "Gap between cells", children: _jsx(NumberInput, { value: padding, min: 0, max: 2048, onChange: setPadding }) })] }), _jsx(Field, { label: "Cell size (computed)", children: _jsx("p", { className: "font-mono text-xs text-ink-300", children: natural
                                                ? `${Math.round(cell.w)} × ${Math.round(cell.h)} px`
                                                : "—" }) }), _jsx(Field, { label: "Name prefix", children: _jsx(Input, { value: namePrefix, onChange: setNamePrefix }) }), _jsx(Toggle, { label: "Number sequentially (cell-001, cell-002, \u2026)", checked: autoNumber, onChange: setAutoNumber }), _jsx(Toggle, { label: "Trim transparent edges per cell", checked: trim, onChange: setTrim }), _jsxs("p", { className: "text-[10px] text-ink-500", children: ["Will create ", _jsx("span", { className: "text-ink-300", children: rows * cols }), " assets in this project."] })] })] }) }), busy && (_jsxs("div", { className: "border-y border-ink-700 bg-ink-950/40 px-4 py-2 text-[11px] text-ink-300", children: ["Uploading ", progress.done, " of ", progress.total, "\u2026"] })), error && !busy && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: error })), _jsxs("footer", { className: "flex items-center justify-between gap-2 border-t border-ink-700 px-4 py-3", children: [_jsx("p", { className: "text-[11px] text-ink-500", children: trim
                                ? "Each cell is cropped to its non-transparent bounding box before upload."
                                : "Cells are cropped to the grid rectangle exactly as drawn." }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "button", onClick: commit, disabled: busy || !natural || cell.w < 1 || cell.h < 1, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: busy ? "Splitting…" : `Split into ${rows * cols} assets` })] })] })] }) }));
}
// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/** Strip a trailing `.png` / `.jpg` etc so the prefix doesn't end up doubled. */
function stripExtension(name) {
    return name.replace(/\.[a-z0-9]+$/i, "");
}
/** Zero-pad to the digit width of `total` so sort order matches creation. */
function pad(n, total) {
    const width = String(total).length;
    return String(n).padStart(width, "0");
}
/**
 * Fetch the asset blob via the authenticated URL. We use the same query-param
 * form `assetBlobUrl` produces so the browser cache lines up with whatever
 * other places (img tags, picker) already pulled.
 */
async function fetchAssetBlob(id) {
    const url = api.assetBlobUrl(id);
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok)
        throw new Error(`Failed to load source asset (${r.status})`);
    return r.blob();
}
/**
 * Tight bounding box of pixels with alpha > 0. Returns null when the cell
 * is fully transparent (caller should skip the upload, but we return the
 * full cell as-is since callers want N×M outputs predictably).
 *
 * Algorithm: scan rows top→bottom for the first non-zero alpha row, then
 * bottom→top, then the same for columns. O(w*h) worst case, but most
 * sprite cells terminate the inner loop fast.
 */
function nonTransparentBBox(ctx, w, h) {
    if (w === 0 || h === 0)
        return null;
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const a = data[(y * w + x) * 4 + 3];
            if (a > 0) {
                if (x < minX)
                    minX = x;
                if (y < minY)
                    minY = y;
                if (x > maxX)
                    maxX = x;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (maxX < 0 || maxY < 0)
        return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
// ---------------------------------------------------------------------------
// inline form primitives — kept here so the modal is fully self-contained.
// ---------------------------------------------------------------------------
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function Input({ value, onChange }) {
    return (_jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function NumberInput({ value, min, max, onChange, }) {
    return (_jsx("input", { type: "number", min: min, max: max, value: value, onChange: (e) => {
            const v = e.target.value;
            if (v === "")
                return;
            const n = Number(v);
            if (!Number.isNaN(n)) {
                let next = Math.round(n);
                if (typeof min === "number")
                    next = Math.max(min, next);
                if (typeof max === "number")
                    next = Math.min(max, next);
                onChange(next);
            }
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function Toggle({ label, checked, onChange, }) {
    return (_jsxs("label", { className: "flex items-center gap-2 text-xs text-ink-100", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked), className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { children: label })] }));
}
