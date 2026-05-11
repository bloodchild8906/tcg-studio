import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";
import {
  detectFrames,
  findFrameIssues,
  findFrameAtPoint,
  getFrameSignature,
  mergeFrameList,
  type SpriteFrame,
  type FrameIssueReport,
} from "@/lib/spriteCore";

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
export function SpriteSplitter({
  asset,
  open,
  projectId,
  onClose,
  onSplit,
}: {
  asset: Asset | null;
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onSplit: (created: Asset[]) => void;
}) {
  // Splitting mode. Grid divides the source uniformly; Detect runs a
  // connected-component pass over the alpha/luminance channel to find
  // each object's bbox automatically. Useful for irregular sheets
  // (icon packs, hand-drawn collages) where a uniform grid wouldn't
  // line up.
  const [mode, setMode] = useState<"grid" | "detect">("grid");
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [padding, setPadding] = useState(0);
  const [margin, setMargin] = useState(0);
  const [trim, setTrim] = useState(false);
  const [autoNumber, setAutoNumber] = useState(true);
  const [namePrefix, setNamePrefix] = useState("");
  // Detect-mode parameters. Mirrors the spriteSplitter-master core
  // options (referencePoint / tolerance / alphaTolerance / minWidth /
  // minHeight / minPixels / connectivity / mergeDistance / padding /
  // backgroundRemoval / feather). Eyedropper UI sets referencePoint
  // by clicking a pixel in the preview.
  const [refPoint, setRefPoint] = useState({ x: 0, y: 0 });
  const [pickingRef, setPickingRef] = useState(false);
  const [tolerance, setTolerance] = useState(8);
  const [alphaTolerance, setAlphaTolerance] = useState(8);
  const [minWidth, setMinWidth] = useState(4);
  const [minHeight, setMinHeight] = useState(4);
  const [minPixels, setMinPixels] = useState(16);
  const [connectivity, setConnectivity] = useState<4 | 8>(4);
  const [mergeDistance, setMergeDistance] = useState(0);
  const [detectPadding, setDetectPadding] = useState(2);
  const [bgRemoval, setBgRemoval] = useState<"connected" | "global">("connected");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Cached ImageData of the source — read once and reused for every
  // detection pass so dragging sliders doesn't re-fetch the asset.
  const [sourceData, setSourceData] = useState<ImageData | null>(null);
  // Detected frames (in source-image coordinates) + an ignore set.
  // The ignore set lets the user prune false positives without
  // changing the detection options. Each detected frame is identified
  // by its signature (x:y:w:h) so re-running detection keeps the
  // ignore set stable across slider tweaks that don't shift anything.
  const [detected, setDetected] = useState<SpriteFrame[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<FrameIssueReport | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);

  // Reset whenever a new asset is opened so previous numbers don't leak.
  useEffect(() => {
    if (!open || !asset) return;
    setMode("grid");
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
    setRefPoint({ x: 0, y: 0 });
    setPickingRef(false);
    setTolerance(8);
    setAlphaTolerance(8);
    setMinWidth(4);
    setMinHeight(4);
    setMinPixels(16);
    setConnectivity(4);
    setMergeDistance(0);
    setDetectPadding(2);
    setBgRemoval("connected");
    setSourceData(null);
    setDetected([]);
    setIgnored(new Set());
    setSelected(new Set());
    setIssues(null);
    setDetectError(null);
  }, [open, asset]);

  // Re-measure displayed image size on load + resize. Mirrors the same
  // pattern used by the 9-slice editor — image-space coords are the
  // source of truth, screen-space is just for drawing the overlay.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    function measure() {
      if (!img) return;
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
    if (!natural) return { w: 0, h: 0 };
    const w = (natural.w - margin * 2 - padding * (cols - 1)) / cols;
    const h = (natural.h - margin * 2 - padding * (rows - 1)) / rows;
    return { w: Math.max(0, w), h: Math.max(0, h) };
  }, [natural, rows, cols, padding, margin]);

  // Lazy-load the source ImageData when the user switches to detect
  // mode. We keep it cached so subsequent slider tweaks don't refetch.
  useEffect(() => {
    if (mode !== "detect" || !asset || !natural || sourceData) return;
    let cancelled = false;
    (async () => {
      try {
        const blob = await fetchAssetBlob(asset.id);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D context unavailable");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close?.();
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (!cancelled) setSourceData(data);
      } catch (err) {
        if (!cancelled) {
          setDetectError(err instanceof Error ? err.message : "Couldn't read source");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, asset, natural, sourceData]);

  // Recompute detected bboxes whenever the source data or any
  // detect-mode parameter changes. We run this synchronously since
  // even a 2048×2048 image labels in ~100ms on a modern laptop and
  // the user is actively dragging sliders — no point introducing
  // async lag.
  useEffect(() => {
    if (mode !== "detect" || !sourceData) {
      setDetected([]);
      setIssues(null);
      return;
    }
    try {
      const frames = detectFrames(sourceData, {
        referencePoint: refPoint,
        tolerance,
        alphaTolerance,
        minWidth,
        minHeight,
        minPixels,
        connectivity,
        mergeDistance,
        padding: detectPadding,
        backgroundRemoval: bgRemoval,
      });
      setDetected(frames);
      setIssues(
        findFrameIssues(frames, { width: sourceData.width, height: sourceData.height }),
      );
      setDetectError(null);
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : "detect failed");
      setDetected([]);
      setIssues(null);
    }
  }, [
    mode,
    sourceData,
    refPoint,
    tolerance,
    alphaTolerance,
    minWidth,
    minHeight,
    minPixels,
    connectivity,
    mergeDistance,
    detectPadding,
    bgRemoval,
  ]);

  // The unified cell list — what the upload loop iterates over.
  // Grid mode produces rows × cols boxes by tiling; detect mode passes
  // through the connected-component result.
  const cells = useMemo<BBox[]>(() => {
    if (!natural) return [];
    if (mode === "detect") {
      // SpriteFrame → BBox conversion + drop ignored frames. We use
      // the frame signature for ignore matching so slider tweaks that
      // produce the same frame (common when re-detecting) keep the
      // ignore set valid.
      return detected
        .filter((f) => !ignored.has(getFrameSignature(f)))
        .map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height }));
    }
    const out: BBox[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          x: margin + c * (cell.w + padding),
          y: margin + r * (cell.h + padding),
          w: cell.w,
          h: cell.h,
        });
      }
    }
    return out;
  }, [mode, detected, ignored, natural, rows, cols, cell, margin, padding]);

  /** Click on the preview — three modes: pick-reference (eyedropper),
   *  manual frame select, or no-op. Coordinates are in DISPLAY px
   *  relative to the image element; we project to source coords via
   *  the natural-vs-box ratio. */
  function onPreviewClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!natural || !sourceData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const sx = Math.round((dx / Math.max(1, rect.width)) * natural.w);
    const sy = Math.round((dy / Math.max(1, rect.height)) * natural.h);
    if (pickingRef) {
      // Eyedropper — sample this pixel as the new reference and
      // immediately exit pick mode so the user can keep adjusting.
      setRefPoint({ x: Math.max(0, Math.min(natural.w - 1, sx)), y: Math.max(0, Math.min(natural.h - 1, sy)) });
      setPickingRef(false);
      return;
    }
    if (mode !== "detect") return;
    const hit = findFrameAtPoint(detected, { x: sx, y: sy });
    if (!hit) return;
    const sig = getFrameSignature(hit);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });
  }

  function mergeSelected() {
    if (selected.size < 2) return;
    const picked = detected.filter((f) => selected.has(getFrameSignature(f)));
    if (picked.length < 2) return;
    const merged = mergeFrameList(picked);
    if (!merged) return;
    // Replace the picked frames with the merged one in the detected
    // list; clear selection so the next click starts fresh.
    setDetected((prev) => {
      const remaining = prev.filter((f) => !selected.has(getFrameSignature(f)));
      return [...remaining, merged].sort((a, b) =>
        a.y === b.y ? a.x - b.x : a.y - b.y,
      );
    });
    setSelected(new Set());
  }

  function ignoreSelected() {
    if (selected.size === 0) return;
    setIgnored((prev) => {
      const next = new Set(prev);
      for (const s of selected) next.add(s);
      return next;
    });
    setSelected(new Set());
  }

  function restoreIgnored() {
    setIgnored(new Set());
  }

  if (!open || !asset) return null;

  async function commit() {
    if (!asset || !natural) return;
    if (cells.length === 0) {
      setError(
        mode === "detect"
          ? "No objects detected — adjust threshold / min size."
          : "Cell size is zero — reduce padding/margin or row/column count.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    const total = cells.length;
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
      if (!ctx) throw new Error("Could not get 2D canvas context");

      const created: Asset[] = [];
      for (let idx = 0; idx < cells.length; idx++) {
        const cellBox = cells[idx];
        const sx = cellBox.x;
        const sy = cellBox.y;
        let sw = cellBox.w;
        let sh = cellBox.h;
        let dx = 0;
        let dy = 0;

        // Per-cell trim is only meaningful in grid mode — detect mode
        // already produced a tight bbox. Avoid running an extra
        // ImageData round-trip when we don't need to.
        if (trim && mode === "grid") {
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
            }
          }
        }

        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (trim && mode === "grid" && (dx !== 0 || dy !== 0)) {
          ctx.drawImage(bitmap, sx, sy, cellBox.w, cellBox.h, dx, dy, cellBox.w, cellBox.h);
        } else {
          ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        }

        const cellBlob: Blob | null = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/png");
        });
        if (!cellBlob) throw new Error(`Failed to encode cell ${idx + 1}`);

        // Naming — grid mode keeps the r/c-aware fallback; detect mode
        // numbers sequentially since there's no row/col concept.
        let fileName: string;
        if (mode === "detect") {
          fileName = `${namePrefix || "object"}-${pad(idx + 1, total)}.png`;
        } else if (autoNumber) {
          fileName = `${namePrefix || "cell"}-${pad(idx + 1, total)}.png`;
        } else {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          fileName = `${namePrefix || "cell"}-r${r + 1}-c${c + 1}.png`;
        }
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
      bitmap.close?.();
      onSplit(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "split failed");
    } finally {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Split ${asset.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex h-[85vh] w-[min(880px,94vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Split spritesheet</h2>
            <p className="font-mono text-[11px] text-ink-500">{asset.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-[1fr_260px] gap-4">
            <div
              className="relative overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:14px_14px]"
              style={{ minHeight: 320 }}
            >
              <img
                ref={imgRef}
                src={api.assetBlobUrl(asset.id)}
                alt=""
                onLoad={(e) =>
                  setNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
                draggable={false}
              />
              {natural && box.w > 0 && box.h > 0 && (
                <svg
                  onClick={onPreviewClick}
                  className="absolute"
                  style={{
                    left: `calc(50% - ${box.w / 2}px)`,
                    top: `calc(50% - ${box.h / 2}px)`,
                    width: box.w,
                    height: box.h,
                    cursor: pickingRef
                      ? "crosshair"
                      : mode === "detect"
                        ? "pointer"
                        : "default",
                  }}
                  viewBox={`0 0 ${box.w} ${box.h}`}
                >
                  {/* Cells rendered from the unified `cells` list so
                      grid + detect share the same draw path. In detect
                      mode each cell is clickable for selection; the
                      `selected` set tracks which frames the user picked
                      via signature so re-detection keeps the selection
                      valid when frames don't shift. */}
                  {cells.map((b, i) => {
                    const x = b.x * dispScale;
                    const y = b.y * dispScale;
                    const w = b.w * dispScale;
                    const h = b.h * dispScale;
                    // In detect mode we map back to the underlying
                    // SpriteFrame to read its signature for the
                    // selected/issue lookups.
                    const frame: SpriteFrame | null =
                      mode === "detect"
                        ? { x: b.x, y: b.y, width: b.w, height: b.h, pixelCount: 0 }
                        : null;
                    const sig = frame ? getFrameSignature(frame) : "";
                    const isSelected = sig ? selected.has(sig) : false;
                    const frameIssues = sig ? issues?.bySignature[sig] : undefined;
                    const hasIssue = frameIssues && frameIssues.length > 0;
                    const stroke = isSelected
                      ? "rgba(94, 234, 212, 0.95)" // teal — selected
                      : hasIssue
                        ? "rgba(232, 90, 79, 0.85)" // red — flagged
                        : "rgba(212, 162, 76, 0.85)"; // brass — normal
                    const fill = isSelected
                      ? "rgba(94, 234, 212, 0.18)"
                      : hasIssue
                        ? "rgba(232, 90, 79, 0.10)"
                        : "rgba(212, 162, 76, 0.08)";
                    return (
                      <g key={i}>
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={isSelected ? 2 : 1}
                        />
                        {mode === "detect" && (
                          <text
                            x={x + 3}
                            y={y + 11}
                            fill={isSelected ? "rgba(94,234,212,0.95)" : "rgba(212,162,76,0.95)"}
                            fontSize="10"
                            fontFamily="monospace"
                            pointerEvents="none"
                          >
                            {i + 1}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {/* Reference-pixel crosshair — shows where bg color
                      gets sampled in detect mode. Tiny + brass so it
                      doesn't compete with the bboxes. */}
                  {mode === "detect" && natural && (
                    <g pointerEvents="none">
                      <circle
                        cx={refPoint.x * dispScale}
                        cy={refPoint.y * dispScale}
                        r={4}
                        fill="none"
                        stroke="rgba(212, 162, 76, 0.95)"
                        strokeWidth={1.5}
                      />
                      <line
                        x1={refPoint.x * dispScale - 6}
                        x2={refPoint.x * dispScale + 6}
                        y1={refPoint.y * dispScale}
                        y2={refPoint.y * dispScale}
                        stroke="rgba(212, 162, 76, 0.95)"
                        strokeWidth={1}
                      />
                      <line
                        x1={refPoint.x * dispScale}
                        x2={refPoint.x * dispScale}
                        y1={refPoint.y * dispScale - 6}
                        y2={refPoint.y * dispScale + 6}
                        stroke="rgba(212, 162, 76, 0.95)"
                        strokeWidth={1}
                      />
                    </g>
                  )}
                </svg>
              )}
            </div>

            <div className="space-y-3">
              <Field label="Source size">
                <p className="font-mono text-xs text-ink-300">
                  {natural ? `${natural.w} × ${natural.h} px` : "Loading…"}
                </p>
              </Field>

              <Field label="Mode">
                <div className="flex gap-1.5">
                  <ModeBtn active={mode === "grid"} onClick={() => setMode("grid")}>
                    Grid
                  </ModeBtn>
                  <ModeBtn active={mode === "detect"} onClick={() => setMode("detect")}>
                    Detect objects
                  </ModeBtn>
                </div>
              </Field>

              {mode === "grid" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Rows">
                      <NumberInput value={rows} min={1} max={64} onChange={setRows} />
                    </Field>
                    <Field label="Columns">
                      <NumberInput value={cols} min={1} max={64} onChange={setCols} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Margin (px)" hint="Outer border ignored">
                      <NumberInput value={margin} min={0} max={2048} onChange={setMargin} />
                    </Field>
                    <Field label="Padding (px)" hint="Gap between cells">
                      <NumberInput value={padding} min={0} max={2048} onChange={setPadding} />
                    </Field>
                  </div>
                  <Field label="Cell size (computed)">
                    <p className="font-mono text-xs text-ink-300">
                      {natural
                        ? `${Math.round(cell.w)} × ${Math.round(cell.h)} px`
                        : "—"}
                    </p>
                  </Field>
                </>
              )}

              {mode === "detect" && (
                <>
                  <Field label="Reference pixel" hint="Click 'Pick' then click a background pixel on the sheet.">
                    <div className="flex items-center gap-2 text-xs text-ink-200">
                      <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[10px]">
                        ({refPoint.x}, {refPoint.y})
                      </code>
                      <button
                        type="button"
                        onClick={() => setPickingRef((v) => !v)}
                        className={[
                          "rounded border px-2 py-0.5 text-[10px]",
                          pickingRef
                            ? "border-accent-500/50 bg-accent-500/15 text-accent-300"
                            : "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700",
                        ].join(" ")}
                      >
                        {pickingRef ? "Click sheet…" : "Pick"}
                      </button>
                    </div>
                  </Field>
                  <Field label="BG removal">
                    <div className="flex gap-1.5">
                      <ModeBtn
                        active={bgRemoval === "connected"}
                        onClick={() => setBgRemoval("connected")}
                      >
                        Connected
                      </ModeBtn>
                      <ModeBtn
                        active={bgRemoval === "global"}
                        onClick={() => setBgRemoval("global")}
                      >
                        Global
                      </ModeBtn>
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="RGB tol." hint="Color tolerance (0..255)">
                      <NumberInput value={tolerance} min={0} max={255} onChange={setTolerance} />
                    </Field>
                    <Field label="Alpha tol." hint="Alpha tolerance (0..255)">
                      <NumberInput
                        value={alphaTolerance}
                        min={0}
                        max={255}
                        onChange={setAlphaTolerance}
                      />
                    </Field>
                  </div>
                  <Field label="Connectivity">
                    <div className="flex gap-1.5">
                      <ModeBtn active={connectivity === 4} onClick={() => setConnectivity(4)}>
                        4-way
                      </ModeBtn>
                      <ModeBtn active={connectivity === 8} onClick={() => setConnectivity(8)}>
                        8-way
                      </ModeBtn>
                    </div>
                  </Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Min W">
                      <NumberInput value={minWidth} min={1} max={4096} onChange={setMinWidth} />
                    </Field>
                    <Field label="Min H">
                      <NumberInput value={minHeight} min={1} max={4096} onChange={setMinHeight} />
                    </Field>
                    <Field label="Min px">
                      <NumberInput
                        value={minPixels}
                        min={1}
                        max={1048576}
                        onChange={setMinPixels}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Merge dist." hint="Combine bboxes within N px">
                      <NumberInput
                        value={mergeDistance}
                        min={0}
                        max={1024}
                        onChange={setMergeDistance}
                      />
                    </Field>
                    <Field label="Padding" hint="Expand each bbox by this many px">
                      <NumberInput
                        value={detectPadding}
                        min={0}
                        max={128}
                        onChange={setDetectPadding}
                      />
                    </Field>
                  </div>
                  {/* Frame actions — only meaningful when there's a
                      selection. "Merge" combines selected boxes into
                      one; "Ignore" hides them from the export. */}
                  <Field
                    label={`Selection (${selected.size})`}
                    hint="Click frames in the preview to select them."
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={mergeSelected}
                        disabled={selected.size < 2}
                        className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        onClick={ignoreSelected}
                        disabled={selected.size === 0}
                        className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                      >
                        Ignore
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        disabled={selected.size === 0}
                        className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={restoreIgnored}
                        disabled={ignored.size === 0}
                        className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[10px] text-ink-300 hover:bg-ink-700 disabled:opacity-40"
                        title={`Restore ${ignored.size} ignored frame${ignored.size === 1 ? "" : "s"}`}
                      >
                        Restore ({ignored.size})
                      </button>
                    </div>
                  </Field>
                  {issues && issues.warnings.length > 0 && (
                    <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                      {issues.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </div>
                  )}
                  {detectError && (
                    <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
                      {detectError}
                    </p>
                  )}
                </>
              )}

              <Field label="Name prefix">
                <Input value={namePrefix} onChange={setNamePrefix} />
              </Field>
              {mode === "grid" && (
                <>
                  <Toggle
                    label="Number sequentially (cell-001, cell-002, …)"
                    checked={autoNumber}
                    onChange={setAutoNumber}
                  />
                  <Toggle
                    label="Trim transparent edges per cell"
                    checked={trim}
                    onChange={setTrim}
                  />
                </>
              )}
              <p className="text-[10px] text-ink-500">
                Will create{" "}
                <span className="text-ink-300">{cells.length}</span> asset
                {cells.length === 1 ? "" : "s"} in this project.
              </p>
            </div>
          </div>
        </div>

        {busy && (
          <div className="border-y border-ink-700 bg-ink-950/40 px-4 py-2 text-[11px] text-ink-300">
            Uploading {progress.done} of {progress.total}…
          </div>
        )}
        {error && !busy && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-ink-700 px-4 py-3">
          <p className="text-[11px] text-ink-500">
            {mode === "detect"
              ? "Each detected object is uploaded as its own asset."
              : trim
                ? "Each cell is cropped to its non-transparent bounding box before upload."
                : "Cells are cropped to the grid rectangle exactly as drawn."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={busy || !natural || cells.length === 0}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
            >
              {busy ? "Splitting…" : `Split into ${cells.length} assets`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Strip a trailing `.png` / `.jpg` etc so the prefix doesn't end up doubled. */
function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

/** Zero-pad to the digit width of `total` so sort order matches creation. */
function pad(n: number, total: number): string {
  const width = String(total).length;
  return String(n).padStart(width, "0");
}

/**
 * Fetch the asset blob via the authenticated URL. We use the same query-param
 * form `assetBlobUrl` produces so the browser cache lines up with whatever
 * other places (img tags, picker) already pulled.
 */
async function fetchAssetBlob(id: string): Promise<Blob> {
  const url = api.assetBlobUrl(id);
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error(`Failed to load source asset (${r.status})`);
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
function nonTransparentBBox(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  if (w === 0 || h === 0) return null;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// inline form primitives — kept here so the modal is fully self-contained.
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") return;
        const n = Number(v);
        if (!Number.isNaN(n)) {
          let next = Math.round(n);
          if (typeof min === "number") next = Math.max(min, next);
          if (typeof max === "number") next = Math.min(max, next);
          onChange(next);
        }
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 cursor-pointer accent-accent-500"
      />
      <span>{label}</span>
    </label>
  );
}

/** Pill-style segment button — used for the Grid/Detect + bg-mode picks. */
function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 rounded border px-2 py-1 text-[11px]",
        active
          ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
          : "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Object detection                                                            */
/* -------------------------------------------------------------------------- */

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DetectOpts {
  bgMode: "corner" | "transparent";
  /** For "transparent": pixels with alpha ≤ this count as background.
   *  For "corner": pixels with RGB distance ≤ this from the sampled
   *  corner color count as background. Same slider repurposed. */
  bgThreshold: number;
  /** Drop components whose width OR height (in source px) is less
   *  than this. Filters out speckle and JPEG-edge noise. */
  minSize: number;
  /** Expand each bbox outward by this many px after detection. */
  padding: number;
}

/**
 * Find each object's bounding box on a spritesheet via a single-pass
 * connected-component label. We don't bother with disjoint-set / union-
 * find — the algorithm walks pixels once, BFS-flooding each unlabeled
 * foreground pixel and accumulating its bbox. O(w*h) time, O(w*h)
 * memory for the label array.
 *
 * For a typical 1024×1024 sheet this runs in ~50ms — fast enough to
 * recompute on every slider tweak without debouncing.
 *
 * Returns bboxes sorted top-to-bottom, then left-to-right (reading
 * order). Caller assigns filenames in that order so the user gets a
 * predictable mapping from visual position to filename suffix.
 */
function detectObjects(src: ImageData, opts: DetectOpts): BBox[] {
  const w = src.width;
  const h = src.height;
  const d = src.data;

  // Background sampler — either a flat alpha-threshold or an RGB
  // distance to the four-corner average. Both return `true` when the
  // pixel at (x,y) should be considered background.
  let isBg: (x: number, y: number) => boolean;
  if (opts.bgMode === "transparent") {
    const thr = Math.max(0, Math.min(255, opts.bgThreshold));
    isBg = (x, y) => d[(y * w + x) * 4 + 3] <= thr;
  } else {
    // Corner mode — average a 3×3 patch at each corner.
    const samples: Array<[number, number]> = [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ];
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sn = 0;
    for (const [px, py] of samples) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, px + dx));
          const yy = Math.min(h - 1, Math.max(0, py + dy));
          const i = (yy * w + xx) * 4;
          sr += d[i];
          sg += d[i + 1];
          sb += d[i + 2];
          sn += 1;
        }
      }
    }
    const kr = sr / sn;
    const kg = sg / sn;
    const kb = sb / sn;
    const thr = Math.max(1, opts.bgThreshold);
    const thrSq = thr * thr;
    isBg = (x, y) => {
      const i = (y * w + x) * 4;
      const dr = d[i] - kr;
      const dg = d[i + 1] - kg;
      const db = d[i + 2] - kb;
      // Also catch fully-transparent pixels regardless of color — JPEG
      // backdrops sometimes have a 1px alpha border that confuses pure
      // RGB distance.
      if (d[i + 3] <= 8) return true;
      return dr * dr + dg * dg + db * db <= thrSq;
    };
  }

  // Labels: 0 = unvisited, 1 = background, 2+ = component id.
  // Using a Uint32Array for cache locality + zero-init.
  const labels = new Uint32Array(w * h);
  const boxes: BBox[] = [];

  // BFS queue reused across components — Uint32Array indices into the
  // labels buffer. Sizing it at w*h avoids resizing during a worst
  // case ("everything's one big component").
  const queue = new Int32Array(w * h);

  let nextLabel = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] !== 0) continue;
      if (isBg(x, y)) {
        labels[idx] = 1;
        continue;
      }
      // Flood from (x, y) marking everything reachable.
      const label = nextLabel++;
      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      labels[idx] = label;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      while (head < tail) {
        const p = queue[head++];
        const py = (p / w) | 0;
        const px = p - py * w;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        // 4-neighborhood — diagonals tend to merge unrelated
        // sprites that happen to touch at a corner.
        if (px > 0) {
          const n = p - 1;
          if (labels[n] === 0) {
            if (isBg(px - 1, py)) labels[n] = 1;
            else {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
        }
        if (px < w - 1) {
          const n = p + 1;
          if (labels[n] === 0) {
            if (isBg(px + 1, py)) labels[n] = 1;
            else {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
        }
        if (py > 0) {
          const n = p - w;
          if (labels[n] === 0) {
            if (isBg(px, py - 1)) labels[n] = 1;
            else {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
        }
        if (py < h - 1) {
          const n = p + w;
          if (labels[n] === 0) {
            if (isBg(px, py + 1)) labels[n] = 1;
            else {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < opts.minSize || bh < opts.minSize) continue;
      const pad = Math.max(0, opts.padding | 0);
      boxes.push({
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        w: Math.min(w, maxX + 1 + pad) - Math.max(0, minX - pad),
        h: Math.min(h, maxY + 1 + pad) - Math.max(0, minY - pad),
      });
    }
  }

  // Sort reading-order (top-to-bottom, then left-to-right). Use a
  // bucket-by-row-height tolerance so bboxes that are roughly on the
  // same row don't get reordered by tiny y-jitter.
  const rowTol = Math.max(8, Math.floor(boxes.reduce((m, b) => Math.max(m, b.h), 0) / 2));
  boxes.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > rowTol) return dy;
    return a.x - b.x;
  });
  return boxes;
}
