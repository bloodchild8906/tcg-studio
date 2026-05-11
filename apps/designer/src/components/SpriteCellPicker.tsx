import { useEffect, useMemo, useState } from "react";
import { assetBlobUrl } from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";

/**
 * Modal that lets the user pick a single cell from a spritesheet.
 *
 * Reads the grid dimensions from `asset.metadataJson.sheet`:
 *   { cellW, cellH, padding?, margin? }
 *
 * Cols / rows are derived from the natural image dimensions + the
 * grid config. The picker renders the sheet at 1x with an overlay of
 * cell rectangles; clicking a rectangle resolves with that cell's
 * (col, row) and the corresponding pixel rect (so consumers don't
 * have to recompute the offset).
 *
 * If the asset has no sheet metadata, the modal shows an empty state
 * pointing the user at the AssetEditor where they can configure it.
 */

export interface SheetGrid {
  cellW: number;
  cellH: number;
  padding: number;
  margin: number;
  cols: number;
  rows: number;
}

export interface SpriteRef {
  /** Asset ID (the sheet itself; cell metadata travels alongside). */
  assetId: string;
  /** Zero-based cell index. */
  col: number;
  row: number;
  /** Pixel rect of the cell within the source image. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function SpriteCellPicker({
  asset,
  open,
  onClose,
  onPick,
}: {
  asset: Asset | null;
  open: boolean;
  onClose: () => void;
  onPick: (ref: SpriteRef) => void;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<{ col: number; row: number } | null>(null);

  useEffect(() => {
    if (!open || !asset) return;
    setNatural(null);
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = assetBlobUrl(asset.id);
    return () => {
      img.onload = null;
    };
  }, [open, asset]);

  const grid = useMemo<SheetGrid | null>(() => {
    if (!asset || !natural) return null;
    return computeGrid(asset, natural);
  }, [asset, natural]);

  if (!open || !asset) return null;

  function pickCell(col: number, row: number) {
    if (!grid || !asset) return;
    const x = grid.margin + col * (grid.cellW + grid.padding);
    const y = grid.margin + row * (grid.cellH + grid.padding);
    onPick({
      assetId: asset.id,
      col,
      row,
      x,
      y,
      w: grid.cellW,
      h: grid.cellH,
    });
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(85vh,720px)] w-[min(95vw,1000px)] flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <div>
            <h2 className="text-base font-medium text-ink-100">Pick a sprite</h2>
            <p className="text-[11px] text-ink-500">{asset.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto bg-ink-950 p-4">
          {!grid ? (
            <div className="mx-auto max-w-md rounded border border-ink-800 bg-ink-900 p-6 text-center text-sm text-ink-400">
              <p>This asset doesn't have spritesheet metadata yet.</p>
              <p className="mt-2 text-xs text-ink-500">
                Open it in the asset editor and turn on{" "}
                <strong className="text-ink-300">Spritesheet grid</strong> with
                a cell width and height.
              </p>
            </div>
          ) : (
            <div className="mx-auto inline-block">
              <div
                className="relative inline-block bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:14px_14px]"
                style={{ width: natural!.w, height: natural!.h }}
              >
                <img
                  src={assetBlobUrl(asset.id)}
                  alt={asset.name}
                  draggable={false}
                  className="absolute inset-0 select-none"
                  style={{
                    width: natural!.w,
                    height: natural!.h,
                    imageRendering: "pixelated",
                  }}
                />
                {Array.from({ length: grid.rows }).map((_, row) =>
                  Array.from({ length: grid.cols }).map((_, col) => {
                    const x = grid.margin + col * (grid.cellW + grid.padding);
                    const y = grid.margin + row * (grid.cellH + grid.padding);
                    const isHover = hover && hover.col === col && hover.row === row;
                    return (
                      <button
                        key={`${col}-${row}`}
                        type="button"
                        onClick={() => pickCell(col, row)}
                        onMouseEnter={() => setHover({ col, row })}
                        onMouseLeave={() => setHover(null)}
                        title={`Cell (${col}, ${row})`}
                        className={[
                          "absolute border transition-colors",
                          isHover
                            ? "border-accent-400 bg-accent-500/30"
                            : "border-ink-700/40 bg-transparent hover:border-accent-500/60 hover:bg-accent-500/10",
                        ].join(" ")}
                        style={{
                          left: x,
                          top: y,
                          width: grid.cellW,
                          height: grid.cellH,
                        }}
                      />
                    );
                  }),
                )}
              </div>
              <div className="mt-3 text-center text-[11px] text-ink-400">
                {grid.cols} × {grid.rows} cells · cell size {grid.cellW} ×{" "}
                {grid.cellH} px
                {hover && (
                  <span className="ml-2 text-accent-300">
                    · hovering ({hover.col}, {hover.row})
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Reads sheet metadata off an asset and computes a grid dimension
 * struct. Returns null when the asset has no sheet config or the
 * config can't produce at least one cell.
 */
export function computeGrid(
  asset: Asset,
  natural: { w: number; h: number },
): SheetGrid | null {
  const meta = asset.metadataJson ?? {};
  const sheet = meta.sheet as
    | { cellW?: number; cellH?: number; padding?: number; margin?: number }
    | undefined;
  if (!sheet) return null;
  const cellW = Number(sheet.cellW);
  const cellH = Number(sheet.cellH);
  if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 0 || cellH <= 0) {
    return null;
  }
  const padding = Number(sheet.padding) || 0;
  const margin = Number(sheet.margin) || 0;
  const usableW = natural.w - margin * 2 + padding;
  const usableH = natural.h - margin * 2 + padding;
  const cols = Math.max(1, Math.floor(usableW / (cellW + padding)));
  const rows = Math.max(1, Math.floor(usableH / (cellH + padding)));
  return { cellW, cellH, padding, margin, cols, rows };
}

/**
 * Convenience: turn a {col,row} reference + the asset into the full
 * SpriteRef (with absolute pixel coords). Null when the asset isn't a
 * sheet or the cell is out of range. Useful for re-hydrating a stored
 * sprite ref when only `{assetId, col, row}` was persisted.
 */
export async function resolveSpriteRect(
  asset: Asset,
  col: number,
  row: number,
): Promise<SpriteRef | null> {
  // Fast path: if the asset has explicit width/height we can compute
  // without loading the image. Most uploaded assets carry these from
  // the multipart upload pipeline.
  if (asset.width && asset.height) {
    const grid = computeGrid(asset, { w: asset.width, h: asset.height });
    if (!grid) return null;
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
    return {
      assetId: asset.id,
      col,
      row,
      x: grid.margin + col * (grid.cellW + grid.padding),
      y: grid.margin + row * (grid.cellH + grid.padding),
      w: grid.cellW,
      h: grid.cellH,
    };
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const grid = computeGrid(asset, { w: img.naturalWidth, h: img.naturalHeight });
      if (!grid) return resolve(null);
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) {
        return resolve(null);
      }
      resolve({
        assetId: asset.id,
        col,
        row,
        x: grid.margin + col * (grid.cellW + grid.padding),
        y: grid.margin + row * (grid.cellH + grid.padding),
        w: grid.cellW,
        h: grid.cellH,
      });
    };
    img.onerror = () => resolve(null);
    img.src = assetBlobUrl(asset.id);
  });
}
