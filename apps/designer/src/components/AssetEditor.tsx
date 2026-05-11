import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";

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
export function AssetEditor({
  asset,
  open,
  onClose,
  onSaved,
}: {
  asset: Asset | null;
  open: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}) {
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
  /**
   * Spritesheet grid metadata. When configured, the asset can be used
   * AS A SHEET — pickers in other parts of the app will let the user
   * select a specific cell rather than the whole image. The CMS
   * asset_image block, the card's image layer, and the AssetPicker all
   * read this from `metadataJson.sheet`.
   *
   * Shape:
   *   { cellW, cellH, padding?, margin? }
   *
   * Cols/rows are derived from the natural image dimensions at use
   * time, so we don't have to chase resizing edits.
   */
  const [sheetEnabled, setSheetEnabled] = useState(false);
  const [sheet, setSheet] = useState({
    cellW: 64,
    cellH: 64,
    padding: 0,
    margin: 0,
  });
  // Natural dimensions are surfaced from SliceImagePreview; we keep them
  // here too so the PPU section can show "X × Y units" without having to
  // re-decode the image. The preview component sets them via the
  // `onNaturalSize` callback below.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when modal opens with a new asset.
  useEffect(() => {
    if (!open || !asset) return;
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
    } else {
      setSliceEnabled(false);
      setSlice({ top: 24, right: 24, bottom: 24, left: 24 });
    }
    const storedPpu = Number(meta.pixelsPerUnit);
    if (Number.isFinite(storedPpu) && storedPpu > 0) {
      setPpuEnabled(true);
      setPixelsPerUnit(storedPpu);
    } else {
      setPpuEnabled(false);
      setPixelsPerUnit(100);
    }
    const storedSheet = meta.sheet as
      | { cellW?: number; cellH?: number; padding?: number; margin?: number }
      | undefined;
    if (storedSheet && Number(storedSheet.cellW) > 0 && Number(storedSheet.cellH) > 0) {
      setSheetEnabled(true);
      setSheet({
        cellW: Number(storedSheet.cellW),
        cellH: Number(storedSheet.cellH),
        padding: Number(storedSheet.padding) || 0,
        margin: Number(storedSheet.margin) || 0,
      });
    } else {
      setSheetEnabled(false);
      setSheet({ cellW: 64, cellH: 64, padding: 0, margin: 0 });
    }
    setNatural(null);
  }, [open, asset]);

  if (!open || !asset) return null;

  async function save() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      // Merge new slice config into existing metadata so we don't drop fields
      // we don't know about (license, tags, etc.).
      const nextMetadata = { ...(asset.metadataJson ?? {}) } as Record<string, unknown>;
      if (sliceEnabled) {
        nextMetadata.slice = slice;
      } else {
        delete nextMetadata.slice;
      }
      if (ppuEnabled && pixelsPerUnit > 0) {
        nextMetadata.pixelsPerUnit = pixelsPerUnit;
      } else {
        delete nextMetadata.pixelsPerUnit;
      }
      if (sheetEnabled && sheet.cellW > 0 && sheet.cellH > 0) {
        nextMetadata.sheet = sheet;
      } else {
        delete nextMetadata.sheet;
      }
      const updated = await api.updateAsset(asset.id, {
        name,
        type,
        visibility,
        metadataJson: nextMetadata,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${asset.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Edit asset</h2>
            <p className="font-mono text-[11px] text-ink-500">{asset.id}</p>
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
          <div className="grid grid-cols-[220px_1fr] gap-4">
            <SliceImagePreview
              src={api.assetBlobUrl(asset.id)}
              slice={slice}
              onSliceChange={setSlice}
              editable={sliceEnabled}
              onNaturalSize={setNatural}
            />

            <div className="space-y-3">
              <Field label="Name">
                <Input value={name} onChange={setName} />
              </Field>
              <Field label="Type" hint="frame, art, icon, panel, font, …">
                <Input value={type} onChange={setType} />
              </Field>
              <Field label="Visibility">
                <Select
                  value={visibility}
                  options={["private", "tenant_internal", "project_internal", "public"]}
                  onChange={setVisibility}
                />
              </Field>
              <Field label="Mime / size">
                <p className="text-xs text-ink-300">
                  {asset.mimeType} · {asset.fileSize.toLocaleString()} B
                </p>
              </Field>
            </div>
          </div>

          <section className="mt-6 rounded border border-ink-700 bg-ink-900/40 p-3">
            <Toggle
              label="9-slice frame"
              checked={sliceEnabled}
              onChange={setSliceEnabled}
            />
            <p className="mt-1 text-[11px] text-ink-500">
              When enabled, image layers picking this asset auto-apply the slice
              insets so the corners stay crisp at any size.
            </p>
            {sliceEnabled && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Top (px)">
                  <NumberInput
                    value={slice.top}
                    onChange={(v) => setSlice({ ...slice, top: v })}
                  />
                </Field>
                <Field label="Right (px)">
                  <NumberInput
                    value={slice.right}
                    onChange={(v) => setSlice({ ...slice, right: v })}
                  />
                </Field>
                <Field label="Bottom (px)">
                  <NumberInput
                    value={slice.bottom}
                    onChange={(v) => setSlice({ ...slice, bottom: v })}
                  />
                </Field>
                <Field label="Left (px)">
                  <NumberInput
                    value={slice.left}
                    onChange={(v) => setSlice({ ...slice, left: v })}
                  />
                </Field>
              </div>
            )}
          </section>

          <section className="mt-4 rounded border border-ink-700 bg-ink-900/40 p-3">
            <Toggle
              label="Pixels per unit"
              checked={ppuEnabled}
              onChange={setPpuEnabled}
            />
            <p className="mt-1 text-[11px] text-ink-500">
              How many source pixels equal one logical unit. Pixel art often
              uses 16, 32, or 64; high-res art typically 100. Layers and
              exports can size by units instead of texture pixels.
            </p>
            {ppuEnabled && (
              <>
                <div className="mt-3 grid grid-cols-[140px_1fr] items-end gap-3">
                  <Field label="PPU">
                    <NumberInput
                      value={pixelsPerUnit}
                      onChange={(v) => setPixelsPerUnit(Math.max(1, v))}
                    />
                  </Field>
                  <Field label="Size in units">
                    <p className="font-mono text-xs text-ink-300">
                      {natural && pixelsPerUnit > 0
                        ? `${(natural.w / pixelsPerUnit).toFixed(2)} × ${(
                            natural.h / pixelsPerUnit
                          ).toFixed(2)} u`
                        : "—"}
                    </p>
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[16, 32, 64, 100, 128].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setPixelsPerUnit(preset)}
                      className={[
                        "rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        pixelsPerUnit === preset
                          ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                          : "border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600 hover:bg-ink-800",
                      ].join(" ")}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="mt-4 rounded border border-ink-700 bg-ink-900/40 p-3">
            <Toggle
              label="Spritesheet grid"
              checked={sheetEnabled}
              onChange={setSheetEnabled}
            />
            <p className="mt-1 text-[11px] text-ink-500">
              Mark this image as a spritesheet so other parts of the app can
              pick a single cell from it (without splitting the sheet into
              separate assets). The original stays intact; consumers crop
              client-side.
            </p>
            {sheetEnabled && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label="Cell width (px)">
                    <NumberInput
                      value={sheet.cellW}
                      onChange={(v) => setSheet({ ...sheet, cellW: Math.max(1, v) })}
                    />
                  </Field>
                  <Field label="Cell height (px)">
                    <NumberInput
                      value={sheet.cellH}
                      onChange={(v) => setSheet({ ...sheet, cellH: Math.max(1, v) })}
                    />
                  </Field>
                  <Field label="Padding (px)" hint="Gap between cells">
                    <NumberInput
                      value={sheet.padding}
                      onChange={(v) => setSheet({ ...sheet, padding: Math.max(0, v) })}
                    />
                  </Field>
                  <Field label="Margin (px)" hint="Border around the sheet">
                    <NumberInput
                      value={sheet.margin}
                      onChange={(v) => setSheet({ ...sheet, margin: Math.max(0, v) })}
                    />
                  </Field>
                </div>
                {natural && sheet.cellW > 0 && sheet.cellH > 0 && (
                  <p className="mt-2 text-[11px] text-ink-400">
                    Grid:{" "}
                    <span className="font-mono text-ink-200">
                      {Math.max(
                        1,
                        Math.floor(
                          (natural.w - sheet.margin * 2 + sheet.padding) /
                            (sheet.cellW + sheet.padding),
                        ),
                      )}{" "}
                      ×{" "}
                      {Math.max(
                        1,
                        Math.floor(
                          (natural.h - sheet.margin * 2 + sheet.padding) /
                            (sheet.cellH + sheet.padding),
                        ),
                      )}
                    </span>{" "}
                    cells from a {natural.w} × {natural.h} px sheet.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    [16, 16],
                    [32, 32],
                    [64, 64],
                    [128, 128],
                  ].map(([w, h]) => (
                    <button
                      key={`${w}x${h}`}
                      type="button"
                      onClick={() => setSheet({ ...sheet, cellW: w, cellH: h })}
                      className={[
                        "rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        sheet.cellW === w && sheet.cellH === h
                          ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                          : "border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600 hover:bg-ink-800",
                      ].join(" ")}
                    >
                      {w}×{h}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {error && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-3">
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
            onClick={save}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

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
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") return;
        const n = Number(v);
        if (!Number.isNaN(n)) onChange(Math.max(0, Math.round(n)));
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
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
function SliceImagePreview({
  src,
  slice,
  onSliceChange,
  editable,
  onNaturalSize,
}: {
  src: string;
  slice: { top: number; right: number; bottom: number; left: number };
  onSliceChange: (s: { top: number; right: number; bottom: number; left: number }) => void;
  editable: boolean;
  /** Notify the parent when the underlying image dimensions are known. */
  onNaturalSize?: (size: { w: number; h: number }) => void;
}) {
  // Natural dimensions of the source image — used to convert screen-space
  // drag deltas into image-space pixels for the slice insets.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // The SVG matches the displayed image bounding box exactly. We track its
  // size so the per-edge handle hit areas can be computed correctly.
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Re-measure on load and on resize. ResizeObserver beats window resize
  // because the modal can grow/shrink without the window changing (e.g.
  // when the user opens the dev tools split horizontally).
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

  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
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
  function startDrag(edge: "top" | "right" | "bottom" | "left") {
    return (e: React.PointerEvent<SVGRectElement>) => {
      if (!editable || !natural) return;
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

      function onMove(ev: PointerEvent) {
        const dxPx = (ev.clientX - startX) * scaleX;
        const dyPx = (ev.clientY - startY) * scaleY;
        const next = { ...start };
        if (edge === "top") {
          // Drag down increases top inset; clamp so it can't pass the
          // bottom edge (leaves at least 1px of center).
          next.top = clampInset(start.top + dyPx, 0, natural!.h - start.bottom - 1);
        } else if (edge === "bottom") {
          // Drag down DECREASES the bottom inset (the line moves away
          // from the bottom edge of the image).
          next.bottom = clampInset(start.bottom - dyPx, 0, natural!.h - start.top - 1);
        } else if (edge === "left") {
          next.left = clampInset(start.left + dxPx, 0, natural!.w - start.right - 1);
        } else if (edge === "right") {
          next.right = clampInset(start.right - dxPx, 0, natural!.w - start.left - 1);
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

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:14px_14px]"
        style={{ aspectRatio: "1 / 1" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          onLoad={onLoad}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
          draggable={false}
        />
        {natural && box.w > 0 && box.h > 0 && (
          <svg
            // Position absolutely over the displayed image bounds. The
            // image is centered in the square via object-contain, so we
            // compute its top/left offset from the wrapper to align.
            className="pointer-events-none absolute"
            style={{
              left: `calc(50% - ${box.w / 2}px)`,
              top: `calc(50% - ${box.h / 2}px)`,
              width: box.w,
              height: box.h,
            }}
            viewBox={`0 0 ${box.w} ${box.h}`}
          >
            {/* Inner rectangle showing the unstretched center area. The
                4 corners of this rect are exactly the 9-slice frame
                corners — visualizing this is the whole point of the
                editor. */}
            <rect
              x={guideLeftX}
              y={guideTopY}
              width={Math.max(0, guideRightX - guideLeftX)}
              height={Math.max(0, guideBottomY - guideTopY)}
              fill="none"
              stroke={guideStroke}
              strokeDasharray="5 4"
              strokeWidth={1}
            />
            {/* Edge lines extend across the full image so the user can
                see exactly where each cut falls. */}
            <line x1={0} y1={guideTopY} x2={box.w} y2={guideTopY} stroke={guideStroke} strokeWidth={1} />
            <line x1={0} y1={guideBottomY} x2={box.w} y2={guideBottomY} stroke={guideStroke} strokeWidth={1} />
            <line x1={guideLeftX} y1={0} x2={guideLeftX} y2={box.h} stroke={guideStroke} strokeWidth={1} />
            <line x1={guideRightX} y1={0} x2={guideRightX} y2={box.h} stroke={guideStroke} strokeWidth={1} />

            {/* Drag-handle hit areas. Wider than the visible line so
                they're forgiving on touch / trackpad. The pointer-events
                attribute re-enables interaction (the parent <svg> has
                pointer-events: none so the image is clickable elsewhere
                — this granularity matters because we don't want the
                user to start a drag by clicking outside a handle). */}
            <rect
              x={0}
              y={guideTopY - 6}
              width={box.w}
              height={12}
              fill={handleFill}
              style={{
                cursor: editable ? "ns-resize" : cursor,
                pointerEvents: editable ? "auto" : "none",
              }}
              onPointerDown={startDrag("top")}
            />
            <rect
              x={0}
              y={guideBottomY - 6}
              width={box.w}
              height={12}
              fill={handleFill}
              style={{
                cursor: editable ? "ns-resize" : cursor,
                pointerEvents: editable ? "auto" : "none",
              }}
              onPointerDown={startDrag("bottom")}
            />
            <rect
              x={guideLeftX - 6}
              y={0}
              width={12}
              height={box.h}
              fill={handleFill}
              style={{
                cursor: editable ? "ew-resize" : cursor,
                pointerEvents: editable ? "auto" : "none",
              }}
              onPointerDown={startDrag("left")}
            />
            <rect
              x={guideRightX - 6}
              y={0}
              width={12}
              height={box.h}
              fill={handleFill}
              style={{
                cursor: editable ? "ew-resize" : cursor,
                pointerEvents: editable ? "auto" : "none",
              }}
              onPointerDown={startDrag("right")}
            />
          </svg>
        )}
      </div>
      <p className="text-[10px] text-ink-500">
        {natural
          ? `${natural.w} × ${natural.h} px`
          : "Loading image…"}
        {editable && natural ? " · Drag the dashed lines to set insets." : ""}
      </p>
    </div>
  );
}

function clampInset(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
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
