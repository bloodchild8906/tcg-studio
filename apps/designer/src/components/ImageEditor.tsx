import { forwardRef, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";
import { magicWand, selectObjectAt } from "@/lib/objectDetect";

/**
 * In-place image editor for an Asset.
 *
 * Operations supported (client-side, on a canvas):
 *   • Crop (drag a region — handles for corners and the inside)
 *   • Rotate 90° CW / CCW
 *   • Flip horizontally / vertically
 *
 * The user can either save the result as a NEW asset (preferred,
 * non-destructive — original stays intact) or replace the existing
 * asset's bytes by re-uploading with the same name. Replace is a
 * thin convenience: we delete the old row and upload a new one.
 *
 * The editor renders into a `<canvas>` sized to the original image
 * resolution and applies all pending transforms when the user clicks
 * Save. The on-screen preview is the canvas scaled with CSS, so the
 * crop region is in *display* coordinates and we map back to source
 * pixels at save time.
 *
 * Uses native fetch + canvas API only — no extra deps. Heavy work
 * (rotation, blob encoding) happens once on Save, not on every
 * pointer move, so the UI stays responsive even on large images.
 */

export interface ImageEditorProps {
  asset: Asset | null;
  open: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  /**
   * Project to attach the new asset to. Required for "save as new"
   * because tenant-level assets (no project) are unusual; if you want
   * one, leave the field empty and the asset inherits the source's
   * projectId.
   */
  projectId?: string | null;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Output resize. Percent applies after crop+rotate so a 50% resize on
 * a 1024×1024 source crops to whatever the user picked, then halves
 * those pixel dimensions. We intentionally don't expose absolute
 * width/height here — those couple awkwardly with rotation, so the
 * percent knob is a friendlier mental model for an in-place edit.
 */
interface ResizeOpts {
  /** 100 = keep original. 50 = half size. 200 = double. */
  percent: number;
}

const DEFAULT_RESIZE: ResizeOpts = { percent: 100 };

/**
 * Background removal. Two modes:
 *   - "luma":   knock out pixels brighter than `threshold` (good for
 *               line-art on a near-white background — common card art
 *               source).
 *   - "chroma": knock out pixels close to the four-corner average
 *               sampled at save time (good for solid-color backdrops).
 * `softness` controls the alpha falloff so edges don't go pixelated.
 */
interface BgRemoveOpts {
  enabled: boolean;
  mode: "luma" | "chroma";
  /** 0..255. For luma: brightness cutoff. For chroma: max distance. */
  threshold: number;
  /** 0..255. How much beyond `threshold` fades to transparent. */
  softness: number;
}

const DEFAULT_BG_REMOVE: BgRemoveOpts = {
  enabled: false,
  mode: "luma",
  threshold: 230,
  softness: 25,
};

export function ImageEditor({
  asset,
  open,
  onClose,
  onSaved,
  projectId,
}: ImageEditorProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [effects, setEffects] = useState<ImageEffects>(DEFAULT_EFFECTS);
  const [resize, setResize] = useState<ResizeOpts>(DEFAULT_RESIZE);
  const [bgRemove, setBgRemove] = useState<BgRemoveOpts>(DEFAULT_BG_REMOVE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"new" | "replace">("new");
  // Active tool — "crop" treats mouse drags as crop-region edits;
  // "erase" treats them as alpha-paint strokes onto the working canvas.
  const [tool, setTool] = useState<"crop" | "erase" | "select" | "wand">("crop");
  const [eraserSize, setEraserSize] = useState(32);
  const [eraserHardness, setEraserHardness] = useState(0.8);
  // Cursor position over the canvas — drives the paint.net-style
  // status bar at the bottom (x, y in source-image pixels, plus the
  // size of the loaded image). Null when the pointer is off-canvas
  // so the status bar shows "—" instead of stale coordinates.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // Object-select parameters. Same shape as the sprite splitter's
  // detect mode — clicking a pixel runs a single flood from there and
  // sets the crop to the detected bbox.
  const [selectBgMode, setSelectBgMode] = useState<"transparent" | "corner">("transparent");
  const [selectThreshold, setSelectThreshold] = useState(24);
  const [selectPadding, setSelectPadding] = useState(2);
  // Cached ImageData of the working canvas. Refreshed when the user
  // switches to select/wand tool so erase strokes affect what gets picked.
  const [selectSource, setSelectSource] = useState<ImageData | null>(null);
  // Magic-wand selection parameters.
  const [wandTolerance, setWandTolerance] = useState(24);
  const [wandAlphaTolerance, setWandAlphaTolerance] = useState(8);
  const [wandContiguous, setWandContiguous] = useState(true);
  /**
   * Per-pixel selection mask in SOURCE coordinates (working canvas
   * dims). 1 = pixel is inside the selection, 0 = outside. When set,
   * destructive ops (eraser) only affect pixels where the mask is 1,
   * and the rendered preview masks all visual effects to the same
   * region (untouched pixels render as the un-effected source).
   * Cleared by the "Deselect" button or pressing Escape.
   */
  const selectionMaskRef = useRef<Uint8Array | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  // Versioned so changes to the mask trigger preview re-render.
  const [selectionVersion, setSelectionVersion] = useState(0);
  // Asset metadata editors (9-slice / 25-slice / PPU). These edit
  // `asset.metadataJson` in place and persist via PATCH on Save Meta —
  // independent of the destructive-pixel save path so the user can
  // tweak slicing without re-uploading. Initialized from the asset on
  // mount; reset to defaults when the modal opens with a fresh asset.
  const [slice9, setSlice9] = useState<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null>(null);
  const [slice25, setSlice25] = useState<{
    outerTop: number;
    outerRight: number;
    outerBottom: number;
    outerLeft: number;
    innerTop: number;
    innerRight: number;
    innerBottom: number;
    innerLeft: number;
    maxStretchX?: number;
    maxStretchY?: number;
  } | null>(null);
  const [ppu, setPpu] = useState(0);
  const [metaDirty, setMetaDirty] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  // Bumps every time the working canvas is modified so the preview
  // effect re-renders. Necessary because the canvas itself is a
  // mutable ref — React doesn't know its bytes changed otherwise.
  const [workingVersion, setWorkingVersion] = useState(0);
  // Tracks whether any eraser stroke has landed on the working canvas.
  // Used to force PNG output (JPEG can't carry alpha — the cutout would
  // be silently flattened against black on save).
  const hasErasedRef = useRef(false);

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Working canvas — holds the source image with destructive
  // edits (currently just eraser strokes) baked in at full source
  // resolution. Initialized when the image loads. All downstream
  // operations (transforms / effects / crop / bg-remove / resize)
  // run on top of this canvas, so the eraser composes correctly with
  // every other tool.
  const workingRef = useRef<HTMLCanvasElement | null>(null);

  // Load the source image whenever the modal opens with a fresh asset.
  useEffect(() => {
    if (!open || !asset) return;
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setCrop(null);
    setEffects(DEFAULT_EFFECTS);
    setResize(DEFAULT_RESIZE);
    setBgRemove(DEFAULT_BG_REMOVE);
    setTool("crop");
    setError(null);
    setName(`${asset.name} (edited)`);
    setMode("new");
    hasErasedRef.current = false;
    workingRef.current = null;
    setWorkingVersion(0);
    // Seed metadata editors from the asset record.
    const md = asset.metadataJson ?? {};
    setSlice9(md.slice ? { ...md.slice } : null);
    setSlice25(md.slice25 ? { ...md.slice25 } : null);
    setPpu(typeof md.pixelsPerUnit === "number" ? md.pixelsPerUnit : 0);
    setMetaDirty(false);
    setMetaSaving(false);
    selectionMaskRef.current = null;
    setHasSelection(false);
    setSelectionVersion(0);
    setWandTolerance(24);
    setWandAlphaTolerance(8);
    setWandContiguous(true);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Seed the working canvas with the source pixels — eraser
      // strokes paint into this canvas, downstream ops read from it.
      const w = document.createElement("canvas");
      w.width = img.naturalWidth;
      w.height = img.naturalHeight;
      const wctx = w.getContext("2d");
      if (wctx) wctx.drawImage(img, 0, 0);
      workingRef.current = w;
      setImage(img);
      setWorkingVersion((v) => v + 1);
    };
    img.onerror = () =>
      setError("Couldn't load image. Make sure your auth token is valid.");
    img.src = api.assetBlobUrl(asset.id);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [open, asset]);

  // Render the preview canvas whenever transforms or effects change.
  // We deliberately render the *uncropped* preview here; the crop
  // overlay is drawn on top so the user can still drag handles around
  // areas they cropped out. Resize is intentionally skipped at preview
  // time — shrinking the canvas mid-drag would be confusing — so the
  // user only sees the resize effect when they hit Save.
  useEffect(() => {
    if (!image) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    // Prefer the working canvas (which carries any eraser strokes);
    // fall back to the source image while the working canvas is still
    // being seeded on first mount.
    const src = workingRef.current ?? image;
    drawTransformed(
      canvas,
      src,
      { rotation, flipH, flipV },
      null,
      effects,
      bgRemove,
      selectionMaskRef.current,
    );
  }, [
    image,
    rotation,
    flipH,
    flipV,
    effects,
    bgRemove,
    workingVersion,
    selectionVersion,
  ]);

  // Lazily build / refresh the ImageData snapshot the object-select
  // and magic-wand tools flood-fill against. Only runs when one of
  // those tools is active so other tools don't pay the round-trip cost.
  useEffect(() => {
    if (tool !== "select" && tool !== "wand") {
      setSelectSource(null);
      return;
    }
    const w = workingRef.current;
    if (!w) return;
    const ctx = w.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    setSelectSource(ctx.getImageData(0, 0, w.width, w.height));
  }, [tool, workingVersion]);

  // Escape clears the magic-wand selection — a familiar Photoshop /
  // paint.net affordance. Only fires when the modal has focus, so it
  // doesn't accidentally fire while the user is typing in a sidebar
  // input.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && hasSelection) {
        e.preventDefault();
        selectionMaskRef.current = null;
        setHasSelection(false);
        setSelectionVersion((v) => v + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasSelection]);

  if (!open || !asset) return null;

  /**
   * Persist the slice/PPU editors to the asset's metadataJson. Runs
   * independently of the destructive `save()` flow — the user can
   * tweak metadata without producing a "new asset" or replacing bytes.
   * Merges over whatever else is in metadataJson so existing fields
   * (tags, license, author, custom keys) survive.
   */
  async function saveMetadata() {
    if (!asset) return;
    setMetaSaving(true);
    setError(null);
    try {
      const next: Record<string, unknown> = {
        ...((asset.metadataJson as Record<string, unknown>) ?? {}),
      };
      if (slice9) next.slice = slice9;
      else delete next.slice;
      if (slice25) next.slice25 = slice25;
      else delete next.slice25;
      if (ppu > 0) next.pixelsPerUnit = ppu;
      else delete next.pixelsPerUnit;
      const updated = await api.updateAsset(asset.id, { metadataJson: next });
      // Fire onSaved so the parent list reflects the new metadata
      // (badges, sort-order changes if any). Don't close the modal —
      // metadata is a side-edit, the user may still be cropping or
      // erasing.
      onSaved(updated);
      setMetaDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "metadata save failed");
    } finally {
      setMetaSaving(false);
    }
  }

  async function save() {
    if (!image || !asset) return;
    setBusy(true);
    setError(null);
    try {
      // Render the FINAL image at source resolution into a working
      // canvas, then export it as a Blob. We don't trust the
      // preview's CSS scale — we always render fresh at the correct
      // pixel dimensions for the saved bytes. Source is the working
      // canvas (which carries eraser strokes), falling back to the
      // raw image if working isn't ready yet.
      const out = document.createElement("canvas");
      const src = workingRef.current ?? image;
      drawTransformed(
        out,
        src,
        { rotation, flipH, flipV },
        crop ?? null,
        effects,
        bgRemove,
        selectionMaskRef.current,
      );

      // Resize after every other op — that way effects + bg removal
      // run at full resolution, then we downsample once. Avoids
      // re-running the kernel passes against a tiny image.
      const final = resize.percent !== 100 ? resampleCanvas(out, resize.percent / 100) : out;

      // Force PNG whenever we'll be writing alpha — bg removal,
      // feather-edge mode, eraser strokes, or the image was opaque
      // and resize would re-encode through JPEG (which would lose
      // alpha if we later added something transparent). JPEG can't
      // carry alpha; using it here would silently flatten the cutout
      // against black.
      const willWriteAlpha =
        bgRemove.enabled ||
        hasErasedRef.current ||
        (effects.feather > 0 &&
          (effects.featherMode === "edge" || effects.featherMode === "object"));
      const wantsPng =
        willWriteAlpha ||
        (resize.percent !== 100 && asset.mimeType?.includes("jpeg"))
          ? "image/png"
          : asset.mimeType || "image/png";

      const blob: Blob = await new Promise((resolve, reject) => {
        final.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          wantsPng,
          0.95,
        );
      });

      // Build a File so the existing uploadAsset helper accepts it.
      const ext = (asset.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "png").toLowerCase();
      const file = new File([blob], `${name || asset.name}.${ext}`, {
        type: blob.type || asset.mimeType,
      });

      // Save-as-new uploads with the same project + type as the source.
      // Replace deletes the old asset first so the slug-collision check
      // doesn't fire on the new upload.
      if (mode === "replace") {
        await api.deleteAsset(asset.id);
      }

      const created = await api.uploadAsset({
        file,
        projectId: projectId ?? asset.projectId ?? null,
        type: asset.type,
        name,
      });

      onSaved(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(95vh,900px)] w-[min(97vw,1280px)] flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        {/* Title bar — paint.net's slim caption strip at the top. */}
        <header className="flex items-center justify-between border-b border-ink-800 bg-ink-800/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent-500">
              Image Editor
            </span>
            <span className="text-ink-700">·</span>
            <span className="truncate text-xs text-ink-100">{asset.name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
          >
            ×
          </button>
        </header>

        <div className="grid flex-1 grid-cols-[52px_1fr_300px] overflow-hidden">
          {/* Tool palette — vertical strip of icon buttons on the
              left. Each button switches the active tool; the right
              panel's "Tool options" section follows whichever tool
              is selected. */}
          <aside className="flex flex-col items-center gap-1 border-r border-ink-800 bg-ink-800/20 py-2">
            <PaletteBtn
              label="Crop"
              shortcut="C"
              active={tool === "crop"}
              onClick={() => setTool("crop")}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 2v16a2 2 0 0 0 2 2h14" />
                  <path d="M2 6h16a2 2 0 0 1 2 2v14" />
                </svg>
              }
            />
            <PaletteBtn
              label="Select"
              shortcut="S"
              active={tool === "select"}
              onClick={() => setTool("select")}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 18 2-8 8-2L4 4z" />
                </svg>
              }
            />
            <PaletteBtn
              label="Magic wand"
              shortcut="W"
              active={tool === "wand"}
              onClick={() => setTool("wand")}
              icon={
                // Wand with a sparkle — flood-fill by color similarity.
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M15 4l1.5 3L20 8.5 16.5 10 15 13l-1.5-3L10 8.5 13.5 7 15 4z" />
                  <path d="M11 13l-7 7" />
                </svg>
              }
            />
            <PaletteBtn
              label="Erase"
              shortcut="E"
              active={tool === "erase"}
              onClick={() => setTool("erase")}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20 14l-8 8H6l-3-3 14-14 6 6-5 5" />
                </svg>
              }
            />
            {/* Separator + transform actions live on the palette too —
                they're modeless (one click, immediate effect) so they
                fit the paint.net "icon = action" idiom. */}
            <div className="my-2 h-px w-8 bg-ink-700" />
            <PaletteBtn
              label="Rotate CCW"
              onClick={() => setRotation((r) => (r + 270) % 360)}
              icon={<span className="text-base">⟲</span>}
            />
            <PaletteBtn
              label="Rotate CW"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              icon={<span className="text-base">⟳</span>}
            />
            <PaletteBtn
              label="Flip H"
              active={flipH}
              onClick={() => setFlipH((v) => !v)}
              icon={<span className="text-base">↔</span>}
            />
            <PaletteBtn
              label="Flip V"
              active={flipV}
              onClick={() => setFlipV((v) => !v)}
              icon={<span className="text-base">↕</span>}
            />
          </aside>

          {/* Canvas area */}
          <div
            ref={wrapperRef}
            onMouseLeave={() => setCursor(null)}
            className="relative flex items-center justify-center overflow-auto bg-ink-950 p-4"
          >
            {!image ? (
              <p className="text-sm text-ink-500">Loading image…</p>
            ) : (
              <CanvasWithCropOverlay
                ref={previewRef}
                image={image}
                rotation={rotation}
                flipH={flipH}
                flipV={flipV}
                crop={crop}
                onCropChange={setCrop}
                tool={tool}
                eraserSize={eraserSize}
                eraserHardness={eraserHardness}
                ppu={ppu}
                selectionMask={selectionMaskRef.current}
                selectionVersion={selectionVersion}
                onErase={(dispX, dispY) => {
                  // Mouse coords are in DISPLAY-canvas pixels (rotated
                  // source dims). Map them back to SOURCE-canvas coords
                  // so the eraser dab lands at the right pixel
                  // regardless of rotation/flip. The working canvas is
                  // in source coordinates (it's a copy of the original
                  // image's pixel grid).
                  const w = workingRef.current;
                  if (!w || !image) return;
                  const sw = image.naturalWidth;
                  const sh = image.naturalHeight;
                  const src = displayToSource(
                    dispX,
                    dispY,
                    sw,
                    sh,
                    rotation,
                    flipH,
                    flipV,
                  );
                  paintEraser(
                    w,
                    src.x,
                    src.y,
                    eraserSize / 2,
                    eraserHardness,
                    selectionMaskRef.current,
                  );
                  hasErasedRef.current = true;
                  setWorkingVersion((v) => v + 1);
                }}
                onSelectAt={(dispX, dispY) => {
                  // Two click-flood tools share this callback. The
                  // active tool decides what the click produces — a
                  // bbox + crop (Select), or a per-pixel selection
                  // mask (Wand). Both inverse-map display → source
                  // coords first so rotation/flip don't break the
                  // flood-fill seed.
                  if (!image || !selectSource) return;
                  const sw = image.naturalWidth;
                  const sh = image.naturalHeight;
                  const src = displayToSource(
                    dispX,
                    dispY,
                    sw,
                    sh,
                    rotation,
                    flipH,
                    flipV,
                  );
                  const srcX = Math.round(src.x);
                  const srcY = Math.round(src.y);
                  if (tool === "wand") {
                    const mask = magicWand(
                      selectSource,
                      srcX,
                      srcY,
                      wandTolerance,
                      wandAlphaTolerance,
                      wandContiguous,
                    );
                    // Empty selection (e.g. click outside the image)
                    // → leave any existing selection alone instead of
                    // wiping it; the user can hit Escape if they want
                    // to clear.
                    let any = false;
                    for (let i = 0; i < mask.length; i++) {
                      if (mask[i]) {
                        any = true;
                        break;
                      }
                    }
                    if (!any) return;
                    selectionMaskRef.current = mask;
                    setHasSelection(true);
                    setSelectionVersion((v) => v + 1);
                    return;
                  }
                  // Select tool — bbox flood.
                  const bbox = selectObjectAt(
                    selectSource,
                    srcX,
                    srcY,
                    {
                      bgMode: selectBgMode,
                      bgThreshold: selectThreshold,
                      minSize: 4,
                      padding: selectPadding,
                    },
                  );
                  if (bbox) {
                    setCrop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });
                    setTool("crop");
                  }
                }}
                onHover={(dispX, dispY) => {
                  // Map display → source pixels for the status bar so
                  // the readout is honest about what the user is over.
                  if (!image) return;
                  const sw = image.naturalWidth;
                  const sh = image.naturalHeight;
                  const s = displayToSource(
                    dispX,
                    dispY,
                    sw,
                    sh,
                    rotation,
                    flipH,
                    flipV,
                  );
                  setCursor({ x: Math.round(s.x), y: Math.round(s.y) });
                }}
                onLeave={() => setCursor(null)}
              />
            )}
          </div>

          {/* Controls */}
          <aside className="flex flex-col gap-4 overflow-y-auto border-l border-ink-800 p-4">
            <Section title="Tool options">
              <p className="text-[11px] text-ink-500">
                {tool === "crop"
                  ? "Drag on the image to set a crop region. Drag the region to move it; corner handles resize."
                  : tool === "select"
                    ? "Click an object — the connected component floods, and its bbox becomes the crop."
                    : tool === "wand"
                      ? "Click a region — pixels within tolerance flood into a selection. Effects + eraser scope to it. Escape clears."
                      : "Drag to erase. Strokes bake into the source canvas; saves as PNG."}
              </p>
              {tool === "wand" && (
                <>
                  <EffectSlider
                    label="Tolerance"
                    value={wandTolerance}
                    min={0}
                    max={128}
                    step={1}
                    onChange={setWandTolerance}
                  />
                  <EffectSlider
                    label="Alpha tolerance"
                    value={wandAlphaTolerance}
                    min={0}
                    max={128}
                    step={1}
                    onChange={setWandAlphaTolerance}
                  />
                  <label className="flex items-center gap-2 text-xs text-ink-200">
                    <input
                      type="checkbox"
                      checked={wandContiguous}
                      onChange={(e) => setWandContiguous(e.target.checked)}
                    />
                    <span>Contiguous</span>
                  </label>
                  <p className="text-[11px] text-ink-500">
                    {wandContiguous
                      ? "Flood-fill only neighbors within tolerance of the seed."
                      : "Select every pixel in the image matching the seed color."}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        selectionMaskRef.current = null;
                        setHasSelection(false);
                        setSelectionVersion((v) => v + 1);
                      }}
                      disabled={!hasSelection}
                      className="flex-1 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                    >
                      Deselect (Esc)
                    </button>
                  </div>
                  {hasSelection && (
                    <p className="text-[11px] text-accent-300">
                      Selection active — effects + eraser scope to it.
                    </p>
                  )}
                </>
              )}
              {tool === "erase" && (
                <>
                  <EffectSlider
                    label="Brush size"
                    value={eraserSize}
                    min={4}
                    max={256}
                    step={2}
                    unit="px"
                    onChange={setEraserSize}
                  />
                  <EffectSlider
                    label="Hardness"
                    value={eraserHardness}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setEraserHardness}
                  />
                  <p className="text-[11px] text-ink-500">
                    Drag on the image to erase. Strokes bake into the
                    source — saves as PNG to preserve transparency.
                  </p>
                </>
              )}
              {tool === "select" && (
                <>
                  <fieldset className="flex gap-2 text-xs text-ink-300">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="select-bg-mode"
                        checked={selectBgMode === "transparent"}
                        onChange={() => setSelectBgMode("transparent")}
                      />
                      <span>Transparent</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="select-bg-mode"
                        checked={selectBgMode === "corner"}
                        onChange={() => setSelectBgMode("corner")}
                      />
                      <span>Corner color</span>
                    </label>
                  </fieldset>
                  <EffectSlider
                    label="Threshold"
                    value={selectThreshold}
                    min={0}
                    max={255}
                    step={1}
                    onChange={setSelectThreshold}
                  />
                  <EffectSlider
                    label="Padding"
                    value={selectPadding}
                    min={0}
                    max={64}
                    step={1}
                    unit="px"
                    onChange={setSelectPadding}
                  />
                  <p className="text-[11px] text-ink-500">
                    Click an object. The flood fills its connected
                    component and sets the crop to its bbox — hit
                    Save to export just the object.
                  </p>
                </>
              )}
            </Section>

            {/* Rotate / flip controls live on the left tool palette
                now (paint.net-style). The status bar at the bottom
                shows the active transform so we still get visual
                feedback without duplicating buttons here. */}

            <Section title="Crop">
              {crop ? (
                <>
                  <p className="text-[11px] text-ink-400">
                    Region: {Math.round(crop.w)} × {Math.round(crop.h)} px
                    starting at ({Math.round(crop.x)}, {Math.round(crop.y)}).
                  </p>
                  <button
                    type="button"
                    onClick={() => setCrop(null)}
                    className="mt-2 w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
                  >
                    Clear crop
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-ink-500">
                  Drag on the image to draw a crop region. Drag the
                  region to move it; drag a corner to resize.
                </p>
              )}
            </Section>

            <Section title="Effects">
              <p className="text-[11px] text-ink-500">
                ImageMagick-flavored knobs. Drag to taste — heavier values
                cost more on save (sharpen / emboss / edge / feather run a
                pixel pass).
              </p>
              <EffectSlider
                label="Blur"
                value={effects.blur}
                min={0}
                max={20}
                step={0.5}
                unit="px"
                onChange={(v) => setEffects((p) => ({ ...p, blur: v }))}
              />
              <EffectSlider
                label="Sharpen"
                value={effects.sharpen}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => setEffects((p) => ({ ...p, sharpen: v }))}
              />
              <EffectSlider
                label="Brightness"
                value={effects.brightness}
                min={-50}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => setEffects((p) => ({ ...p, brightness: v }))}
              />
              <EffectSlider
                label="Contrast"
                value={effects.contrast}
                min={-50}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => setEffects((p) => ({ ...p, contrast: v }))}
              />
              <EffectSlider
                label="Saturation"
                value={effects.saturation}
                min={-100}
                max={200}
                step={1}
                unit="%"
                onChange={(v) => setEffects((p) => ({ ...p, saturation: v }))}
              />
              <EffectSlider
                label="Hue rotate"
                value={effects.hueRotate}
                min={-180}
                max={180}
                step={1}
                unit="°"
                onChange={(v) => setEffects((p) => ({ ...p, hueRotate: v }))}
              />
              <EffectSlider
                label="Invert"
                value={effects.invert}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setEffects((p) => ({ ...p, invert: v }))}
              />
              <EffectSlider
                label="Grayscale"
                value={effects.grayscale}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setEffects((p) => ({ ...p, grayscale: v }))}
              />
              <EffectSlider
                label="Sepia"
                value={effects.sepia}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setEffects((p) => ({ ...p, sepia: v }))}
              />
              <EffectSlider
                label="Emboss"
                value={effects.emboss}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => setEffects((p) => ({ ...p, emboss: v }))}
              />
              <EffectSlider
                label="Edge detect"
                value={effects.edge}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => setEffects((p) => ({ ...p, edge: v }))}
              />
              <EffectSlider
                label="Feather"
                value={effects.feather}
                min={0}
                max={200}
                step={1}
                unit="px"
                onChange={(v) => setEffects((p) => ({ ...p, feather: v }))}
              />
              {effects.feather > 0 && (
                <fieldset className="grid grid-cols-3 gap-1 pl-1 text-[11px] text-ink-300">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="feather-mode"
                      checked={effects.featherMode === "edge"}
                      onChange={() =>
                        setEffects((p) => ({ ...p, featherMode: "edge" }))
                      }
                    />
                    <span>Edge</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="feather-mode"
                      checked={effects.featherMode === "alpha"}
                      onChange={() =>
                        setEffects((p) => ({ ...p, featherMode: "alpha" }))
                      }
                    />
                    <span>Alpha</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="feather-mode"
                      checked={effects.featherMode === "object"}
                      onChange={() =>
                        setEffects((p) => ({ ...p, featherMode: "object" }))
                      }
                    />
                    <span>Object</span>
                  </label>
                </fieldset>
              )}
              {effects.feather > 0 && effects.featherMode === "edge" && (
                <p className="text-[11px] text-ink-500">
                  Fades the canvas edges to transparent — works on
                  opaque images. Saves as PNG.
                </p>
              )}
              {effects.feather > 0 && effects.featherMode === "object" && (
                <p className="text-[11px] text-ink-500">
                  Detects the foreground (vs. four-corner average) and
                  feathers around its outline — produces a soft cutout
                  in one pass. Saves as PNG.
                </p>
              )}
              <button
                type="button"
                onClick={() => setEffects(DEFAULT_EFFECTS)}
                disabled={effectsAreNoop(effects)}
                className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-50"
              >
                Clear effects
              </button>
            </Section>

            <Section title="Levels">
              <p className="text-[11px] text-ink-500">
                Photoshop-style. Drag inputs to clamp blacks/whites,
                gamma to brighten/darken midtones, outputs to compress
                the dynamic range.
              </p>
              <EffectSlider
                label="In black"
                value={effects.levels.inBlack}
                min={0}
                max={254}
                step={1}
                onChange={(v) =>
                  setEffects((p) => ({
                    ...p,
                    levels: {
                      ...p.levels,
                      inBlack: Math.min(v, p.levels.inWhite - 1),
                    },
                  }))
                }
              />
              <EffectSlider
                label="In white"
                value={effects.levels.inWhite}
                min={1}
                max={255}
                step={1}
                onChange={(v) =>
                  setEffects((p) => ({
                    ...p,
                    levels: {
                      ...p.levels,
                      inWhite: Math.max(v, p.levels.inBlack + 1),
                    },
                  }))
                }
              />
              <EffectSlider
                label="Gamma"
                value={effects.levels.gamma}
                min={0.1}
                max={3}
                step={0.05}
                onChange={(v) =>
                  setEffects((p) => ({ ...p, levels: { ...p.levels, gamma: v } }))
                }
              />
              <EffectSlider
                label="Out black"
                value={effects.levels.outBlack}
                min={0}
                max={254}
                step={1}
                onChange={(v) =>
                  setEffects((p) => ({
                    ...p,
                    levels: {
                      ...p.levels,
                      outBlack: Math.min(v, p.levels.outWhite - 1),
                    },
                  }))
                }
              />
              <EffectSlider
                label="Out white"
                value={effects.levels.outWhite}
                min={1}
                max={255}
                step={1}
                onChange={(v) =>
                  setEffects((p) => ({
                    ...p,
                    levels: {
                      ...p.levels,
                      outWhite: Math.max(v, p.levels.outBlack + 1),
                    },
                  }))
                }
              />
              <button
                type="button"
                onClick={() =>
                  setEffects((p) => ({ ...p, levels: DEFAULT_LEVELS }))
                }
                disabled={levelsAreNoop(effects.levels)}
                className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-50"
              >
                Reset levels
              </button>
            </Section>

            <Section title="Resize on save">
              <p className="text-[11px] text-ink-500">
                Scale the saved image. Doesn't affect the preview — you'll
                see the new size after saving.
              </p>
              <EffectSlider
                label="Scale"
                value={resize.percent}
                min={10}
                max={400}
                step={5}
                unit="%"
                onChange={(v) => setResize({ percent: v })}
              />
              {image && resize.percent !== 100 && (
                <p className="text-[11px] text-ink-400">
                  Output: ~
                  {Math.round(
                    (rotation % 180 === 0 ? image.naturalWidth : image.naturalHeight) *
                      (resize.percent / 100),
                  )}
                  ×
                  {Math.round(
                    (rotation % 180 === 0 ? image.naturalHeight : image.naturalWidth) *
                      (resize.percent / 100),
                  )}{" "}
                  px
                </p>
              )}
            </Section>

            <Section title="Background removal">
              <label className="flex items-center gap-2 text-xs text-ink-200">
                <input
                  type="checkbox"
                  checked={bgRemove.enabled}
                  onChange={(e) =>
                    setBgRemove((p) => ({ ...p, enabled: e.target.checked }))
                  }
                />
                <span>Remove background</span>
              </label>
              {bgRemove.enabled && (
                <>
                  <fieldset className="flex gap-2 text-xs text-ink-300">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-mode"
                        checked={bgRemove.mode === "luma"}
                        onChange={() =>
                          setBgRemove((p) => ({ ...p, mode: "luma" }))
                        }
                      />
                      <span>Luma (white-ish)</span>
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-mode"
                        checked={bgRemove.mode === "chroma"}
                        onChange={() =>
                          setBgRemove((p) => ({ ...p, mode: "chroma" }))
                        }
                      />
                      <span>Chroma (corner color)</span>
                    </label>
                  </fieldset>
                  <EffectSlider
                    label="Threshold"
                    value={bgRemove.threshold}
                    min={0}
                    max={255}
                    step={1}
                    onChange={(v) => setBgRemove((p) => ({ ...p, threshold: v }))}
                  />
                  <EffectSlider
                    label="Softness"
                    value={bgRemove.softness}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(v) => setBgRemove((p) => ({ ...p, softness: v }))}
                  />
                  <p className="text-[11px] text-ink-500">
                    Saves as PNG so transparency survives the encode.
                  </p>
                </>
              )}
            </Section>

            <Section title="Reset">
              <button
                type="button"
                onClick={() => {
                  setRotation(0);
                  setFlipH(false);
                  setFlipV(false);
                  setCrop(null);
                  setEffects(DEFAULT_EFFECTS);
                  setResize(DEFAULT_RESIZE);
                  setBgRemove(DEFAULT_BG_REMOVE);
                }}
                className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
              >
                Reset to original
              </button>
            </Section>

            <Section title="Asset metadata">
              <p className="text-[11px] text-ink-500">
                Saved to the asset record — picked up by every image
                layer that references this asset. Doesn't replace the
                image bytes.
              </p>

              {/* 9-slice */}
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-200">
                <input
                  type="checkbox"
                  checked={!!slice9}
                  onChange={(e) => {
                    setSlice9(
                      e.target.checked
                        ? slice9 ?? { top: 24, right: 24, bottom: 24, left: 24 }
                        : null,
                    );
                    setMetaDirty(true);
                  }}
                />
                <span className="font-medium">9-slice</span>
              </label>
              {slice9 && image && (
                <SliceDragEditor
                  image={image}
                  mode="nine"
                  slice9={slice9}
                  onSlice9={(s) => {
                    setSlice9(s);
                    setMetaDirty(true);
                  }}
                />
              )}
              {slice9 && (
                <div className="grid grid-cols-2 gap-2">
                  {(["top", "right", "bottom", "left"] as const).map((k) => (
                    <label
                      key={k}
                      className="flex items-center gap-1 text-[11px] text-ink-300"
                    >
                      <span className="w-10 uppercase tracking-wider text-ink-500">
                        {k}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={slice9[k]}
                        onChange={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                          setSlice9({ ...slice9, [k]: v });
                          setMetaDirty(true);
                        }}
                        className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                      />
                    </label>
                  ))}
                </div>
              )}

              {/* 25-slice */}
              <label className="mt-3 flex items-center gap-2 text-xs text-ink-200">
                <input
                  type="checkbox"
                  checked={!!slice25}
                  onChange={(e) => {
                    if (e.target.checked) {
                      // Promote from 9-slice if present, else seed with
                      // sensible default — outer 16, inner 1.5x. Clear
                      // 9-slice so they don't both stick (the renderer
                      // prefers 25 when both are set).
                      const base = slice9 ?? { top: 16, right: 16, bottom: 16, left: 16 };
                      setSlice25({
                        outerTop: base.top,
                        outerRight: base.right,
                        outerBottom: base.bottom,
                        outerLeft: base.left,
                        innerTop: Math.round(base.top * 1.5),
                        innerRight: Math.round(base.right * 1.5),
                        innerBottom: Math.round(base.bottom * 1.5),
                        innerLeft: Math.round(base.left * 1.5),
                      });
                      setSlice9(null);
                    } else {
                      setSlice25(null);
                    }
                    setMetaDirty(true);
                  }}
                />
                <span className="font-medium">25-slice</span>
              </label>
              {slice25 && image && (
                <SliceDragEditor
                  image={image}
                  mode="twentyFive"
                  slice25={slice25}
                  onSlice25={(s) => {
                    setSlice25(s);
                    setMetaDirty(true);
                  }}
                />
              )}
              {slice25 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-ink-500">
                    Outer + inner per side. 4 outer corners + 4
                    mid-edge centers stay static; the inner stripes
                    and the dead center stretch.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-ink-300">
                      <span className="w-16 text-ink-500">Max X</span>
                      <input
                        type="number"
                        min={0}
                        value={slice25.maxStretchX ?? 0}
                        onChange={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                          setSlice25({ ...slice25, maxStretchX: v });
                          setMetaDirty(true);
                        }}
                        className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-ink-300">
                      <span className="w-16 text-ink-500">Max Y</span>
                      <input
                        type="number"
                        min={0}
                        value={slice25.maxStretchY ?? 0}
                        onChange={(e) => {
                          const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                          setSlice25({ ...slice25, maxStretchY: v });
                          setMetaDirty(true);
                        }}
                        className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-ink-500">
                    Max distance between static zones in destination
                    pixels. 0 = no cap (single ornament per edge —
                    canonical 5×5 layout). When set, additional center
                    ornaments tile along the edge so no stripe grows
                    larger than this value.
                  </p>
                  {(["Top", "Right", "Bottom", "Left"] as const).map((side) => {
                    const lower = side.toLowerCase() as
                      | "top"
                      | "right"
                      | "bottom"
                      | "left";
                    const outerKey = `outer${side}` as keyof typeof slice25;
                    const innerKey = `inner${side}` as keyof typeof slice25;
                    return (
                      <div key={lower} className="space-y-1">
                        <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                          {side}
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-1 text-[11px] text-ink-300">
                            <span className="w-10 text-ink-500">Outer</span>
                            <input
                              type="number"
                              min={0}
                              value={slice25[outerKey] as number}
                              onChange={(e) => {
                                const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                                const next = { ...slice25, [outerKey]: v };
                                // Keep inner ≥ outer per side.
                                if ((next[innerKey] as number) < v) {
                                  (next as Record<string, number>)[innerKey] = v;
                                }
                                setSlice25(next);
                                setMetaDirty(true);
                              }}
                              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-[11px] text-ink-300">
                            <span className="w-10 text-ink-500">Inner</span>
                            <input
                              type="number"
                              min={0}
                              value={slice25[innerKey] as number}
                              onChange={(e) => {
                                const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                                const next = { ...slice25, [innerKey]: v };
                                if ((next[outerKey] as number) > v) {
                                  (next as Record<string, number>)[outerKey] = v;
                                }
                                setSlice25(next);
                                setMetaDirty(true);
                              }}
                              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* PPU */}
              <div className="mt-3 space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                  Pixels per unit
                </span>
                <input
                  type="number"
                  min={0}
                  value={ppu}
                  onChange={(e) => {
                    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                    setPpu(v);
                    setMetaDirty(true);
                  }}
                  className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
                  placeholder="0 = unset"
                />
                <p className="text-[10px] text-ink-500">
                  Source pixels per logical unit. Lets layer snapping +
                  exports keep pixel-art crisp at any card scale.
                </p>
              </div>

              <button
                type="button"
                onClick={saveMetadata}
                disabled={metaSaving || !metaDirty}
                className="mt-3 w-full rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
              >
                {metaSaving ? "Saving metadata…" : metaDirty ? "Save metadata" : "Metadata saved"}
              </button>
            </Section>

            <Section title="Save">
              <Field label="Name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT}
                />
              </Field>
              <fieldset className="space-y-1 text-xs text-ink-300">
                <legend className="text-[11px] uppercase tracking-wider text-ink-500">
                  Save mode
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="save-mode"
                    checked={mode === "new"}
                    onChange={() => setMode("new")}
                  />
                  <span>Save as new asset (recommended)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="save-mode"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  <span>Replace this asset (deletes original)</span>
                </label>
              </fieldset>
            </Section>

            {error && (
              <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={save}
              disabled={busy || !image}
              className="rounded-md bg-accent-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-400 disabled:opacity-50"
            >
              {busy ? "Saving…" : mode === "new" ? "Save as new asset" : "Replace asset"}
            </button>
          </aside>
        </div>

        {/* Status bar — paint.net's strip at the bottom. Shows source-
            pixel cursor coords (or "—" when the pointer is off-canvas),
            the active tool, the loaded image's natural dimensions, and
            any pending-transform shorthand. Light typography so it
            doesn't compete with the canvas. */}
        <footer className="flex shrink-0 items-center gap-4 border-t border-ink-800 bg-ink-800/40 px-3 py-1 text-[10px] tabular-nums text-ink-400">
          <span className="uppercase tracking-wider text-ink-500">Tool:</span>
          <span className="text-ink-200">
            {tool === "crop"
              ? "Crop"
              : tool === "select"
                ? "Object select"
                : tool === "wand"
                  ? "Magic wand"
                  : "Eraser"}
          </span>
          {hasSelection && (
            <>
              <span className="text-ink-700">|</span>
              <span className="uppercase tracking-wider text-ink-500">Sel:</span>
              <span className="text-accent-300">active</span>
            </>
          )}
          <span className="text-ink-700">|</span>
          <span className="uppercase tracking-wider text-ink-500">Cursor:</span>
          <span className="text-ink-200">
            {cursor ? `${cursor.x}, ${cursor.y}` : "—"}
          </span>
          <span className="text-ink-700">|</span>
          <span className="uppercase tracking-wider text-ink-500">Size:</span>
          <span className="text-ink-200">
            {image ? `${image.naturalWidth} × ${image.naturalHeight} px` : "—"}
          </span>
          {(rotation !== 0 || flipH || flipV) && (
            <>
              <span className="text-ink-700">|</span>
              <span className="uppercase tracking-wider text-ink-500">Transform:</span>
              <span className="text-ink-200">
                {rotation !== 0 ? `${rotation}°` : "0°"}
                {flipH ? " ↔" : ""}
                {flipV ? " ↕" : ""}
              </span>
            </>
          )}
          {crop && (
            <>
              <span className="text-ink-700">|</span>
              <span className="uppercase tracking-wider text-ink-500">Selection:</span>
              <span className="text-ink-200">
                {Math.round(crop.w)} × {Math.round(crop.h)} @ (
                {Math.round(crop.x)}, {Math.round(crop.y)})
              </span>
            </>
          )}
          <span className="ml-auto text-ink-500">
            {hasErasedRef.current && "● unsaved edits"}
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Canvas with crop overlay                                                */
/* ====================================================================== */

interface CanvasWithCropOverlayProps {
  image: HTMLImageElement;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
  onCropChange: (next: CropRect | null) => void;
  /** Active tool. "crop" — drag draws/edits the crop rect. "erase" —
   *  drag paints alpha-out strokes onto the working canvas. "select"
   *  — click flood-fills the connected component at the cursor and
   *  sets the crop to its bbox. */
  tool: "crop" | "erase" | "select" | "wand";
  /** Eraser diameter in DISPLAY-canvas px. The Image-coords mapping
   *  happens upstream so the actual paint is in source pixels. */
  eraserSize: number;
  /** 0..1. Higher = harder edge. Affects the visual cursor only —
   *  the source-pixel paint applies hardness via radial gradient. */
  eraserHardness: number;
  onErase?: (displayX: number, displayY: number) => void;
  onSelectAt?: (displayX: number, displayY: number) => void;
  /** Fires on every mouse move with the source-pixel coords (after
   *  inverse-mapping rotation/flip). Status bar consumes these. */
  onHover?: (sourceX: number, sourceY: number) => void;
  onLeave?: () => void;
  /** Pixels-per-unit from the asset metadata editor. When > 0 a thin
   *  grid renders on top of the preview every `ppu` source-pixels apart
   *  so the user can see the unit cadence live as they tweak the value. */
  ppu?: number;
  /** Magic-wand selection mask in SOURCE coordinates (length =
   *  image.naturalWidth * image.naturalHeight). When set, a marching-
   *  ants-ish outline renders on top of the preview to show what the
   *  effects + eraser are scoped to. */
  selectionMask?: Uint8Array | null;
  /** Bumped by the parent every time the mask changes — used as a
   *  cache key for the overlay canvas. */
  selectionVersion?: number;
}

/**
 * Wraps the preview <canvas> with a transparent overlay that handles
 * crop drawing/dragging. We use mouse events on the overlay so the
 * canvas itself stays a passive render target — easier to reason
 * about and easier to reuse in tests.
 */
const CanvasWithCropOverlay = forwardRef<HTMLCanvasElement, CanvasWithCropOverlayProps>(
  function CanvasWithCropOverlay(
    {
      image,
      rotation,
      flipH,
      flipV,
      crop,
      onCropChange,
      tool,
      eraserSize,
      eraserHardness,
      onErase,
      onSelectAt,
      onHover,
      onLeave,
      ppu = 0,
      selectionMask = null,
      selectionVersion = 0,
    },
    canvasRef,
  ) {
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{
      mode: "draw" | "move" | "resize" | "erase";
      handle?: "nw" | "ne" | "sw" | "se";
      startX: number;
      startY: number;
      orig?: CropRect;
    } | null>(null);
    // Live cursor position for the eraser brush ring. Stored in state
    // so the ring re-renders with the mouse; we clear it on leave so
    // the ring doesn't get stuck on the canvas.
    const [eraseCursor, setEraseCursor] = useState<{ x: number; y: number } | null>(null);

    // Compute the displayed canvas size (before CSS scaling) — same
    // as the rendered image after rotation. We mirror the math from
    // drawTransformed so the overlay matches the canvas.
    const rotated = rotation % 180 !== 0;
    const naturalW = rotated ? image.naturalHeight : image.naturalWidth;
    const naturalH = rotated ? image.naturalWidth : image.naturalHeight;

    // Convert mouse coords → canvas pixel coords. Use the overlay's
    // bounding rect for accurate scaling regardless of CSS layout.
    function toCanvas(e: React.MouseEvent | MouseEvent): { x: number; y: number } {
      const el = overlayRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * naturalW;
      const y = ((e.clientY - r.top) / r.height) * naturalH;
      return { x: Math.max(0, Math.min(naturalW, x)), y: Math.max(0, Math.min(naturalH, y)) };
    }

    function onMouseDown(e: React.MouseEvent) {
      const { x, y } = toCanvas(e);
      // Select / wand tools: a single click runs flood-fill and exits
      // the drag — no continuous gesture. We don't set dragRef so the
      // mouse-move loop ignores subsequent motion until the next click.
      if (tool === "select" || tool === "wand") {
        onSelectAt?.(x, y);
        return;
      }
      // Erase tool: every drag is a stroke. We start a stroke immediately,
      // paint the initial dab, and let the mouse-move loop add more.
      if (tool === "erase") {
        dragRef.current = { mode: "erase", startX: x, startY: y };
        onErase?.(x, y);
        return;
      }
      // If the click is on a corner handle of the existing crop,
      // start a resize. If inside the crop, move it. Otherwise draw
      // a new crop.
      if (crop) {
        const handle = handleHit(crop, x, y, naturalW);
        if (handle) {
          dragRef.current = {
            mode: "resize",
            handle,
            startX: x,
            startY: y,
            orig: { ...crop },
          };
          return;
        }
        if (
          x >= crop.x &&
          x <= crop.x + crop.w &&
          y >= crop.y &&
          y <= crop.y + crop.h
        ) {
          dragRef.current = {
            mode: "move",
            startX: x,
            startY: y,
            orig: { ...crop },
          };
          return;
        }
      }
      dragRef.current = { mode: "draw", startX: x, startY: y };
      onCropChange({ x, y, w: 0, h: 0 });
    }

    function onMouseMove(e: MouseEvent) {
      // Update the eraser cursor ring as the mouse moves over the
      // canvas (regardless of whether a drag is active). The ring
      // gives the user a clear sense of brush radius before clicking.
      if (tool === "erase") {
        const pos = toCanvas(e);
        setEraseCursor(pos);
      }
      if (!dragRef.current) return;
      const { x, y } = toCanvas(e);
      const d = dragRef.current;
      if (d.mode === "erase") {
        // Drag-erase — emit a dab at every move. The dabs are dense
        // enough to draw continuous strokes at typical mouse speed.
        onErase?.(x, y);
        return;
      }
      if (d.mode === "draw") {
        onCropChange({
          x: Math.min(d.startX, x),
          y: Math.min(d.startY, y),
          w: Math.abs(x - d.startX),
          h: Math.abs(y - d.startY),
        });
      } else if (d.mode === "move" && d.orig) {
        const dx = x - d.startX;
        const dy = y - d.startY;
        onCropChange({
          x: Math.max(0, Math.min(naturalW - d.orig.w, d.orig.x + dx)),
          y: Math.max(0, Math.min(naturalH - d.orig.h, d.orig.y + dy)),
          w: d.orig.w,
          h: d.orig.h,
        });
      } else if (d.mode === "resize" && d.orig && d.handle) {
        const next = { ...d.orig };
        if (d.handle.includes("e")) next.w = Math.max(4, x - next.x);
        if (d.handle.includes("s")) next.h = Math.max(4, y - next.y);
        if (d.handle.includes("w")) {
          const right = next.x + next.w;
          next.x = Math.min(right - 4, x);
          next.w = right - next.x;
        }
        if (d.handle.includes("n")) {
          const bottom = next.y + next.h;
          next.y = Math.min(bottom - 4, y);
          next.h = bottom - next.y;
        }
        onCropChange(next);
      }
    }

    function onMouseUp() {
      if (dragRef.current?.mode === "draw") {
        // Tiny accidental drag (just a click) → clear the crop.
        if (crop && (crop.w < 6 || crop.h < 6)) {
          onCropChange(null);
        }
      }
      dragRef.current = null;
    }

    useEffect(() => {
      const move = (e: MouseEvent) => onMouseMove(e);
      const up = () => onMouseUp();
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [crop, naturalW, naturalH]);

    return (
      <div
        ref={overlayRef}
        onMouseDown={onMouseDown}
        onMouseLeave={() => {
          setEraseCursor(null);
          onLeave?.();
        }}
        onMouseMove={(e) => {
          // Always emit source-pixel coords for the status bar — the
          // tool-specific handlers (crop drag, erase paint) attach
          // their own listeners on `window` during a drag, so this
          // top-level listener stays cheap (no drag math, just a
          // bounding-rect projection).
          if (!onHover) return;
          const el = overlayRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * naturalW;
          const y = ((e.clientY - r.top) / r.height) * naturalH;
          if (x < 0 || y < 0 || x > naturalW || y > naturalH) return;
          onHover(x, y);
        }}
        className="relative max-h-full max-w-full select-none"
        style={{
          aspectRatio: `${naturalW} / ${naturalH}`,
          width: "min(100%, 800px)",
          cursor: tool === "erase" ? "none" : undefined,
        }}
      >
        <canvas
          ref={canvasRef}
          width={naturalW}
          height={naturalH}
          className="absolute inset-0 h-full w-full rounded border border-ink-700 object-contain"
        />
        {/* PPU grid — vertical and horizontal guide lines every `ppu`
            source-pixels apart, drawn on top of the preview. PPU is
            isotropic (square unit cells) so rotation doesn't change
            spacing; we just stamp lines on the display canvas. Renders
            only when ppu > 0 — the metadata editor uses 0 = unset. */}
        {ppu > 0 && (
          <PpuGridOverlay
            naturalW={naturalW}
            naturalH={naturalH}
            sourceW={image.naturalWidth}
            sourceH={image.naturalHeight}
            ppu={ppu}
            rotation={rotation}
          />
        )}
        {/* Magic-wand selection outline — semi-transparent teal fill
            over selected pixels, marching-ants would be nicer but a
            stable per-pixel mask reads more clearly at high zoom. The
            mask lives in source coordinates so we rotate/flip a tiny
            offscreen canvas through the same transform as the image. */}
        {selectionMask && (
          <SelectionOverlay
            mask={selectionMask}
            sourceW={image.naturalWidth}
            sourceH={image.naturalHeight}
            naturalW={naturalW}
            naturalH={naturalH}
            rotation={rotation}
            flipH={flipH}
            flipV={flipV}
            version={selectionVersion}
          />
        )}
        {tool === "erase" && eraseCursor && (
          // Brush-radius ring — sized in display px (eraserSize is the
          // display diameter). `pointer-events-none` keeps it from
          // eating the underlying mouse-move events.
          <div
            className="pointer-events-none absolute rounded-full border border-accent-400"
            style={{
              // Translate from canvas px → percent of the overlay rect,
              // then expand by half the brush size.
              left: `calc(${(eraseCursor.x / naturalW) * 100}% - ${eraserSize / 2}px)`,
              top: `calc(${(eraseCursor.y / naturalH) * 100}% - ${eraserSize / 2}px)`,
              width: `${eraserSize}px`,
              height: `${eraserSize}px`,
              borderStyle: eraserHardness >= 0.5 ? "solid" : "dashed",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            }}
          />
        )}
        {tool === "crop" && crop && (
          <div
            className="absolute border-2 border-accent-400 bg-accent-500/10"
            style={{
              left: `${(crop.x / naturalW) * 100}%`,
              top: `${(crop.y / naturalH) * 100}%`,
              width: `${(crop.w / naturalW) * 100}%`,
              height: `${(crop.h / naturalH) * 100}%`,
            }}
          >
            {(["nw", "ne", "sw", "se"] as const).map((h) => (
              <div
                key={h}
                className="absolute h-2 w-2 rounded-sm border border-accent-200 bg-accent-500"
                style={{
                  left: h.includes("w") ? -5 : "auto",
                  right: h.includes("e") ? -5 : "auto",
                  top: h.includes("n") ? -5 : "auto",
                  bottom: h.includes("s") ? -5 : "auto",
                  cursor: `${h}-resize`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

/**
 * Thin SVG grid that stamps a vertical + horizontal guide every `ppu`
 * source-pixels across the preview. Lives in display space (the
 * preview canvas is already rotated), so we just convert source-px
 * spacing to a percentage of the display canvas — works at any zoom.
 *
 * The PPU value is the same in both axes (units are square), but the
 * source dims differ pre/post-rotation, so we compute the X step from
 * the X source-dim and the Y step from the Y source-dim.
 */
function PpuGridOverlay({
  naturalW,
  naturalH,
  sourceW,
  sourceH,
  ppu,
  rotation,
}: {
  naturalW: number;
  naturalH: number;
  sourceW: number;
  sourceH: number;
  ppu: number;
  rotation: number;
}) {
  const rotated = rotation % 180 !== 0;
  // After rotation the display canvas swaps source dims; the grid
  // step in display X corresponds to PPU source-px along the source
  // axis that landed on display X. Math works out to a uniform step
  // since PPU is isotropic — keep both branches explicit for clarity.
  const dispXSrc = rotated ? sourceH : sourceW;
  const dispYSrc = rotated ? sourceW : sourceH;
  if (ppu <= 0 || dispXSrc <= 0 || dispYSrc <= 0) return null;
  const verts: number[] = [];
  for (let x = ppu; x < dispXSrc; x += ppu) verts.push((x / dispXSrc) * naturalW);
  const horiz: number[] = [];
  for (let y = ppu; y < dispYSrc; y += ppu) horiz.push((y / dispYSrc) * naturalH);
  // Cap to a sane number of lines — at a tiny PPU the SVG would
  // contain thousands of paths and bog down the editor. 200 lines
  // each way is enough to give a visual cadence without melting.
  const MAX = 200;
  const vSubset = verts.length > MAX ? verts.filter((_, i) => i % Math.ceil(verts.length / MAX) === 0) : verts;
  const hSubset = horiz.length > MAX ? horiz.filter((_, i) => i % Math.ceil(horiz.length / MAX) === 0) : horiz;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${naturalW} ${naturalH}`}
      // Mirror the main canvas's `object-contain` — letterbox the grid
      // inside the wrapper the same way the image is, so the lines
      // track the underlying pixels even when CSS rounding leaves a
      // sub-pixel gap.
      preserveAspectRatio="xMidYMid meet"
    >
      <g stroke="rgba(245, 158, 11, 0.35)" strokeWidth={Math.max(0.5, naturalW / 1200)}>
        {vSubset.map((x, i) => (
          <line key={`v${i}`} x1={x} x2={x} y1={0} y2={naturalH} />
        ))}
        {hSubset.map((y, i) => (
          <line key={`h${i}`} x1={0} x2={naturalW} y1={y} y2={y} />
        ))}
      </g>
    </svg>
  );
}

/**
 * Paint the magic-wand selection mask as a translucent teal overlay
 * on the preview. The mask lives in SOURCE coords (the working canvas
 * pixel grid); we offscreen-canvas it, then re-draw through the same
 * rotation + flip transform as `drawTransformed` so the overlay tracks
 * the displayed image.
 *
 * Pure visual — no pointer events, no edits. The actual masking of
 * effects + eraser strokes happens upstream.
 */
function SelectionOverlay({
  mask,
  sourceW,
  sourceH,
  naturalW,
  naturalH,
  rotation,
  flipH,
  flipV,
  version: _version,
}: {
  mask: Uint8Array;
  sourceW: number;
  sourceH: number;
  naturalW: number;
  naturalH: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** Cache-busting key so the parent can force a redraw without us
   *  deep-comparing the mask buffer. */
  version: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, naturalW, naturalH);
    if (mask.length !== sourceW * sourceH) return;
    // Render the source-space mask into a same-sized RGBA buffer,
    // then draw it through the rotate+flip chain into the display.
    const src = document.createElement("canvas");
    src.width = sourceW;
    src.height = sourceH;
    const sctx = src.getContext("2d");
    if (!sctx) return;
    const img = sctx.createImageData(sourceW, sourceH);
    const d = img.data;
    // Teal fill at ~40% alpha. Darker around the silhouette feels
    // honest about what's selected while still letting the user see
    // the underlying image.
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        const j = i * 4;
        d[j] = 45;
        d[j + 1] = 212;
        d[j + 2] = 191;
        d[j + 3] = 110;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.translate(naturalW / 2, naturalH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(src, -sourceW / 2, -sourceH / 2);
    ctx.restore();
  }, [mask, sourceW, sourceH, naturalW, naturalH, rotation, flipH, flipV, _version]);
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

function handleHit(
  crop: CropRect,
  x: number,
  y: number,
  naturalW: number,
): "nw" | "ne" | "sw" | "se" | null {
  // Hit radius scales with the canvas width so handles stay grabbable
  // on small images and don't take over the entire crop on huge ones.
  const r = Math.max(4, naturalW / 80);
  const cs: Array<["nw" | "ne" | "sw" | "se", number, number]> = [
    ["nw", crop.x, crop.y],
    ["ne", crop.x + crop.w, crop.y],
    ["sw", crop.x, crop.y + crop.h],
    ["se", crop.x + crop.w, crop.y + crop.h],
  ];
  for (const [name, hx, hy] of cs) {
    if (Math.abs(x - hx) <= r && Math.abs(y - hy) <= r) return name;
  }
  return null;
}

/* ====================================================================== */
/* Canvas drawing                                                          */
/* ====================================================================== */

interface Transform {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/**
 * ImageMagick-flavored effect knobs. Most map to native canvas filter
 * functions (the browser does the heavy lifting); sharpen + emboss +
 * edge-detect run as 3×3 convolutions over ImageData; feather is an
 * alpha-edge softening pass.
 *
 * `0` = effect off. The renderer skips the filter pass entirely when
 * every value is 0, so the un-edited path stays as cheap as before.
 */
export type FeatherMode = "edge" | "alpha" | "object";

/**
 * Levels adjustment — input black/white clamp the dark/bright
 * extremes (everything below `inBlack` becomes 0, above `inWhite`
 * becomes 255), `gamma` re-maps the midtones non-linearly, then
 * output black/white scale the result into a narrower band. Same
 * conventions as Photoshop's Levels dialog. All values 0..255 except
 * gamma which is 0.1..9.99 (1.0 = neutral).
 */
export interface LevelsOpts {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export const DEFAULT_LEVELS: LevelsOpts = {
  inBlack: 0,
  inWhite: 255,
  gamma: 1,
  outBlack: 0,
  outWhite: 255,
};

function levelsAreNoop(l: LevelsOpts): boolean {
  return (
    l.inBlack === 0 &&
    l.inWhite === 255 &&
    l.gamma === 1 &&
    l.outBlack === 0 &&
    l.outWhite === 255
  );
}

export interface ImageEffects {
  /** Gaussian blur radius in px. */
  blur: number;
  /** Sharpen amount, 0–2 (>1 over-sharpens). 3×3 convolution. */
  sharpen: number;
  /** Brightness adjust, percent — 0 keeps original, +30 brightens. */
  brightness: number;
  /** Contrast adjust, percent — same convention. */
  contrast: number;
  /** Saturation adjust, percent. */
  saturation: number;
  /** Hue rotation in degrees, -180..180. */
  hueRotate: number;
  /** Invert, 0..1. */
  invert: number;
  /** Grayscale, 0..1. */
  grayscale: number;
  /** Sepia, 0..1. */
  sepia: number;
  /** Emboss kernel intensity, 0..2. */
  emboss: number;
  /** Edge-detect kernel intensity, 0..2. */
  edge: number;
  /** Feather radius in px. */
  feather: number;
  /**
   * Feather mode:
   *   - "edge":   vignette the canvas rectangle border — fades alpha
   *               from 100% to 0 over `feather` px from each edge.
   *               Works on fully-opaque images.
   *   - "alpha":  box-blur the existing alpha channel. Only does
   *               anything when the image already has transparency.
   *   - "object": detect the foreground using the same background
   *               predicate as bg-removal (mode + threshold pulled
   *               from BgRemoveOpts), then box-blur that mask and
   *               write it to alpha. Soft-cuts the object out of its
   *               background in one pass — useful when you want a
   *               feathered cutout without two separate steps.
   */
  featherMode: FeatherMode;
  /** Per-channel levels adjustment. Applied after CSS-filter effects,
   *  before convolutions, so sharpen sees the level-corrected pixels. */
  levels: LevelsOpts;
}

export const DEFAULT_EFFECTS: ImageEffects = {
  blur: 0,
  sharpen: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hueRotate: 0,
  invert: 0,
  grayscale: 0,
  sepia: 0,
  emboss: 0,
  edge: 0,
  feather: 0,
  featherMode: "edge",
  levels: DEFAULT_LEVELS,
};

function effectsAreNoop(e: ImageEffects): boolean {
  return (
    e.blur === 0 &&
    e.sharpen === 0 &&
    e.brightness === 0 &&
    e.contrast === 0 &&
    e.saturation === 0 &&
    e.hueRotate === 0 &&
    e.invert === 0 &&
    e.grayscale === 0 &&
    e.sepia === 0 &&
    e.emboss === 0 &&
    e.edge === 0 &&
    e.feather === 0 &&
    levelsAreNoop(e.levels)
  );
}

/** Build the canvas `filter` string from effects that the browser
 *  handles natively. The convolution-style ones (sharpen, emboss,
 *  edge, feather) run in a separate pass and are skipped here. */
function effectsToFilterString(e: ImageEffects): string {
  const parts: string[] = [];
  if (e.blur > 0) parts.push(`blur(${e.blur}px)`);
  if (e.brightness !== 0) parts.push(`brightness(${100 + e.brightness}%)`);
  if (e.contrast !== 0) parts.push(`contrast(${100 + e.contrast}%)`);
  if (e.saturation !== 0) parts.push(`saturate(${100 + e.saturation}%)`);
  if (e.hueRotate !== 0) parts.push(`hue-rotate(${e.hueRotate}deg)`);
  if (e.invert > 0) parts.push(`invert(${e.invert})`);
  if (e.grayscale > 0) parts.push(`grayscale(${e.grayscale})`);
  if (e.sepia > 0) parts.push(`sepia(${e.sepia})`);
  return parts.join(" ");
}

/**
 * Paint `image` into `canvas` with the given transforms + effects.
 * When `crop` is supplied, the canvas is sized to the crop and only
 * that region appears. Used both for the live preview and the final
 * save render.
 */
type EditSource = HTMLImageElement | HTMLCanvasElement;

/** Native dimensions of a source — `naturalWidth/naturalHeight` for an
 *  Image (which differ from `width/height` when CSS-scaled), plain
 *  `width/height` for a canvas. We never want the CSS box. */
function sourceDims(s: EditSource): { w: number; h: number } {
  if (s instanceof HTMLCanvasElement) return { w: s.width, h: s.height };
  return { w: s.naturalWidth, h: s.naturalHeight };
}

function drawTransformed(
  canvas: HTMLCanvasElement,
  image: EditSource,
  t: Transform,
  crop: CropRect | null = null,
  effects: ImageEffects = DEFAULT_EFFECTS,
  bgRemove: BgRemoveOpts = DEFAULT_BG_REMOVE,
  /** Per-pixel source-space selection. When set, all effects + bg
   *  removal apply only where mask==1 — the rest of the image renders
   *  as the un-effected (post-transform) source pixels. */
  selectionMask: Uint8Array | null = null,
) {
  const dims = sourceDims(image);
  const rotated = t.rotation % 180 !== 0;
  const sw = rotated ? dims.h : dims.w;
  const sh = rotated ? dims.w : dims.h;

  if (crop) {
    canvas.width = Math.max(1, Math.round(crop.w));
    canvas.height = Math.max(1, Math.round(crop.h));
  } else {
    canvas.width = sw;
    canvas.height = sh;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Step 1: produce a fully-transformed (rotated + flipped) buffer at
  // the natural rotated size, then crop out the requested region.
  const buf = document.createElement("canvas");
  buf.width = sw;
  buf.height = sh;
  const bctx = buf.getContext("2d");
  if (!bctx) return;
  bctx.save();
  bctx.translate(sw / 2, sh / 2);
  bctx.rotate((t.rotation * Math.PI) / 180);
  bctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  bctx.drawImage(
    image,
    -dims.w / 2,
    -dims.h / 2,
    dims.w,
    dims.h,
  );
  bctx.restore();

  // Step 2: apply CSS-filter-style effects on the way to the output
  // canvas. The browser composes the filter chain in one go — order
  // matches what ImageMagick's -modulate / -channel pipelines feel
  // like for these knobs.
  const filterStr = effectsToFilterString(effects);
  if (filterStr) ctx.filter = filterStr;

  if (crop) {
    ctx.drawImage(
      buf,
      Math.round(crop.x),
      Math.round(crop.y),
      Math.round(crop.w),
      Math.round(crop.h),
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    ctx.drawImage(buf, 0, 0);
  }
  if (filterStr) ctx.filter = "none";

  // Step 3: pixel-data effects — levels, sharpen, emboss, edge,
  // feather. Skip the round-trip when none of them are active.
  if (
    effects.sharpen > 0 ||
    effects.emboss > 0 ||
    effects.edge > 0 ||
    effects.feather > 0 ||
    !levelsAreNoop(effects.levels)
  ) {
    applyConvolutions(ctx, canvas.width, canvas.height, effects);
  }

  // Step 4: background removal — runs last so it sees the final
  // composite (post-effects), which is what the user actually wants
  // to key out. Reads + writes the same canvas in a single pass.
  if (bgRemove.enabled) {
    applyBgRemove(ctx, canvas.width, canvas.height, bgRemove);
  }

  // Step 5: if a magic-wand selection is active, composite the
  // un-effected (transform-only) buffer back in everywhere the mask
  // says 0. The result is that effects only "show through" the
  // selected region — exactly what Photoshop calls "scoped to
  // selection". Skipped when there's no mask OR no effects to scope
  // (cheap fast path).
  const effectsActive =
    !effectsAreNoop(effects) || bgRemove.enabled;
  if (selectionMask && effectsActive) {
    compositeMaskedSelection(
      ctx,
      canvas.width,
      canvas.height,
      buf,
      crop,
      selectionMask,
      dims.w,
      dims.h,
      t,
    );
  }
}

/**
 * Replace pixels OUTSIDE the selection with the un-effected post-
 * transform source. The mask is in SOURCE coordinates; we re-project
 * it through the same rotate/flip transform as the buffer so it lines
 * up with the display canvas, then walk the canvas pixel-by-pixel.
 *
 * Cheaper than re-running the whole effect pipeline twice — we already
 * have the unedited buffer (`buf`), the effected output is on `ctx`,
 * and the composite is one ImageData read + write.
 */
function compositeMaskedSelection(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  unedited: HTMLCanvasElement,
  crop: CropRect | null,
  sourceMask: Uint8Array,
  sourceW: number,
  sourceH: number,
  t: Transform,
) {
  // Build a display-space mask canvas at the same resolution as the
  // output. Same transform pipeline as drawImage above.
  const rotated = t.rotation % 180 !== 0;
  const dispW = rotated ? sourceH : sourceW;
  const dispH = rotated ? sourceW : sourceH;
  // 1. Stamp the source mask as RGBA on an offscreen canvas.
  const src = document.createElement("canvas");
  src.width = sourceW;
  src.height = sourceH;
  const sctx = src.getContext("2d");
  if (!sctx) return;
  if (sourceMask.length !== sourceW * sourceH) return;
  const img = sctx.createImageData(sourceW, sourceH);
  const d = img.data;
  for (let i = 0; i < sourceMask.length; i++) {
    if (sourceMask[i]) {
      const j = i * 4;
      d[j + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  // 2. Apply rotation + flip into an intermediate buffer at the
  // display dims, optionally cropping to match the output canvas.
  const xfo = document.createElement("canvas");
  xfo.width = dispW;
  xfo.height = dispH;
  const xctx = xfo.getContext("2d");
  if (!xctx) return;
  xctx.save();
  xctx.translate(dispW / 2, dispH / 2);
  xctx.rotate((t.rotation * Math.PI) / 180);
  xctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  xctx.drawImage(src, -sourceW / 2, -sourceH / 2);
  xctx.restore();
  const maskOut = document.createElement("canvas");
  maskOut.width = outW;
  maskOut.height = outH;
  const moctx = maskOut.getContext("2d");
  if (!moctx) return;
  if (crop) {
    moctx.drawImage(
      xfo,
      Math.round(crop.x),
      Math.round(crop.y),
      Math.round(crop.w),
      Math.round(crop.h),
      0,
      0,
      outW,
      outH,
    );
  } else {
    moctx.drawImage(xfo, 0, 0);
  }
  // 3. Walk pixels: where mask alpha == 0, replace effected output
  // with the unedited buffer's pixel.
  const effected = ctx.getImageData(0, 0, outW, outH);
  const ed = effected.data;
  const maskData = moctx.getImageData(0, 0, outW, outH).data;
  // We also need the unedited pixels at the output resolution —
  // re-crop unedited the same way as the effected buffer.
  const uneditedOut = document.createElement("canvas");
  uneditedOut.width = outW;
  uneditedOut.height = outH;
  const uctx = uneditedOut.getContext("2d");
  if (!uctx) return;
  if (crop) {
    uctx.drawImage(
      unedited,
      Math.round(crop.x),
      Math.round(crop.y),
      Math.round(crop.w),
      Math.round(crop.h),
      0,
      0,
      outW,
      outH,
    );
  } else {
    uctx.drawImage(unedited, 0, 0);
  }
  const ud = uctx.getImageData(0, 0, outW, outH).data;
  for (let i = 0; i < ed.length; i += 4) {
    // Mask alpha 0 → outside selection → restore the unedited pixel.
    if (maskData[i + 3] === 0) {
      ed[i] = ud[i];
      ed[i + 1] = ud[i + 1];
      ed[i + 2] = ud[i + 2];
      ed[i + 3] = ud[i + 3];
    }
  }
  ctx.putImageData(effected, 0, 0);
}

/**
 * Downsample a canvas by `scale` (0..N). When upsizing past 1.0 we
 * still go through the resample path so the output is exactly the
 * declared dimensions; the browser handles bicubic-ish interpolation.
 */
function resampleCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  if (w === src.width && h === src.height) return src;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return out;
}

/**
 * Background removal in-place. Two modes:
 *   - luma: fade alpha based on perceptual brightness (good for
 *     near-white backdrops on line-art).
 *   - chroma: sample the average of the four corners and fade alpha
 *     based on RGB distance to that color (good for solid-color
 *     backdrops on photographed art).
 *
 * `softness` produces a linear ramp so we don't get a hard binary
 * mask — preserves anti-aliased edges.
 */
function applyBgRemove(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: BgRemoveOpts,
) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  if (opts.mode === "chroma") {
    // Average the four corners (a 3×3 patch each) for a robust key.
    // This is more reliable than a single-pixel sample, which often
    // catches an outlier from JPEG noise.
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
          const x = Math.min(w - 1, Math.max(0, px + dx));
          const y = Math.min(h - 1, Math.max(0, py + dy));
          const i = (y * w + x) * 4;
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
    const t = opts.threshold;
    const s = Math.max(1, opts.softness);
    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - kr;
      const dg = d[i + 1] - kg;
      const db = d[i + 2] - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      // dist <= t  → fully transparent
      // dist >= t+softness → unchanged
      // in between  → linear ramp on alpha
      if (dist <= t) {
        d[i + 3] = 0;
      } else if (dist < t + s) {
        d[i + 3] = clamp8((d[i + 3] * (dist - t)) / s);
      }
    }
  } else {
    // luma: standard ITU-R BT.601 weights
    const t = opts.threshold;
    const s = Math.max(1, opts.softness);
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum >= t + s) {
        d[i + 3] = 0;
      } else if (lum > t) {
        d[i + 3] = clamp8((d[i + 3] * (t + s - lum)) / s);
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * Apply the convolution-style + alpha effects in a single pixel-data
 * round-trip. We blend the kernel result against the original by the
 * effect's intensity so a tiny `sharpen=0.3` is gentle, `sharpen=1`
 * is the classic "unsharp mask"-ish look, and `sharpen=2` is over-cooked.
 */
function applyConvolutions(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  e: ImageEffects,
) {
  const src = ctx.getImageData(0, 0, w, h);
  let work = src;
  // Levels first — sharpen sees the corrected pixels. The check
  // matches `levelsAreNoop` so we skip the round-trip when the user
  // hasn't touched the sliders.
  if (!levelsAreNoop(e.levels)) {
    work = applyLevels(work, e.levels);
  }
  if (e.sharpen > 0) {
    work = blendConvolve(
      work,
      [0, -1, 0, -1, 5, -1, 0, -1, 0],
      e.sharpen,
    );
  }
  if (e.edge > 0) {
    work = blendConvolve(
      work,
      [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      e.edge,
      true, // grayscale-ish — the result reads better when monochrome
    );
  }
  if (e.emboss > 0) {
    work = blendConvolve(
      work,
      [-2, -1, 0, -1, 1, 1, 0, 1, 2],
      e.emboss,
    );
  }
  if (e.feather > 0) {
    if (e.featherMode === "object") {
      // Object feather — reuses the bg-removal predicate to find the
      // foreground, then box-blurs that mask. We pull bg settings off
      // the same `bgRemove` config the user already touched (or default
      // luma if they haven't), so the two effects feel coupled.
      work = featherObject(work, e.feather);
    } else if (e.featherMode === "edge") {
      work = featherEdge(work, e.feather);
    } else {
      work = featherAlpha(work, e.feather);
    }
  }
  ctx.putImageData(work, 0, 0);
}

/**
 * Photoshop-style Levels — clamp the input range to [inBlack..inWhite],
 * apply midtone gamma, then rescale into [outBlack..outWhite]. RGB
 * channels are processed identically (luminosity-preserving) since
 * we don't expose per-channel curves yet. Alpha is left alone.
 */
function applyLevels(src: ImageData, l: LevelsOpts): ImageData {
  const w = src.width;
  const h = src.height;
  const out = new ImageData(w, h);
  const s = src.data;
  const o = out.data;

  // Pre-build a 256-entry LUT — much faster than recomputing per-pixel
  // for a multi-megapixel image.
  const lut = new Uint8ClampedArray(256);
  const inRange = Math.max(1, l.inWhite - l.inBlack);
  const outRange = l.outWhite - l.outBlack;
  const invGamma = 1 / Math.max(0.01, l.gamma);
  for (let i = 0; i < 256; i++) {
    const t = clamp01((i - l.inBlack) / inRange);
    const corrected = Math.pow(t, invGamma);
    lut[i] = clamp8(l.outBlack + corrected * outRange);
  }

  for (let i = 0; i < s.length; i += 4) {
    o[i] = lut[s[i]];
    o[i + 1] = lut[s[i + 1]];
    o[i + 2] = lut[s[i + 2]];
    o[i + 3] = s[i + 3];
  }
  return out;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * "Edge feather" — Photoshop's classic feather-selection result.
 * Walks every pixel and multiplies its alpha by a falloff factor
 * based on the shortest distance to any canvas edge. Pixels inside
 * the safe region (distance >= r) keep their alpha; pixels right on
 * an edge go to 0. The falloff is a smoothstep so the transition
 * looks natural rather than ramping linearly.
 *
 * Works on fully-opaque images because it doesn't depend on the
 * existing alpha channel — it overlays a soft rectangular mask.
 */
function featherEdge(src: ImageData, radius: number): ImageData {
  const r = Math.max(1, Math.min(200, Math.round(radius)));
  const w = src.width;
  const h = src.height;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  for (let y = 0; y < h; y++) {
    const dyTop = y;
    const dyBot = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const dx = Math.min(x, w - 1 - x);
      const dy = Math.min(dyTop, dyBot);
      const d = Math.min(dx, dy);
      if (d >= r) continue; // fully opaque — leave alpha alone
      // smoothstep(0, r, d) — ease-in-out so the falloff blends.
      const t = d / r;
      const f = t * t * (3 - 2 * t);
      const idx = (y * w + x) * 4 + 3;
      out.data[idx] = clamp8(src.data[idx] * f);
    }
  }
  return out;
}

/** 3×3 convolution with intensity-blend back to the original. */
function blendConvolve(
  src: ImageData,
  kernel: number[],
  intensity: number,
  toGray = false,
): ImageData {
  const w = src.width;
  const h = src.height;
  const out = new ImageData(w, h);
  const s = src.data;
  const o = out.data;
  const t = Math.min(2, Math.max(0, intensity));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(w - 1, Math.max(0, x + kx));
          const sy = Math.min(h - 1, Math.max(0, y + ky));
          const idx = (sy * w + sx) * 4;
          const k = kernel[(ky + 1) * 3 + (kx + 1)];
          r += s[idx] * k;
          g += s[idx + 1] * k;
          b += s[idx + 2] * k;
        }
      }
      const i = (y * w + x) * 4;
      const baseR = s[i];
      const baseG = s[i + 1];
      const baseB = s[i + 2];
      let outR = r;
      let outG = g;
      let outB = b;
      if (toGray) {
        const gray = (outR + outG + outB) / 3;
        outR = gray;
        outG = gray;
        outB = gray;
      }
      // Blend kernel-result over original by `t` (0..2 — over-sharpen
      // happens past 1.0, by design).
      o[i] = clamp8(baseR + (outR - baseR) * t);
      o[i + 1] = clamp8(baseG + (outG - baseG) * t);
      o[i + 2] = clamp8(baseB + (outB - baseB) * t);
      o[i + 3] = s[i + 3];
    }
  }
  return out;
}

/** Soften the alpha channel near transparency edges by averaging in a
 *  radius. Doesn't touch RGB; only the alpha transitions get rounded
 *  off. Effective for taking hard-edged cutouts and making them blend
 *  on a card layer. */
/**
 * "Object feather" — detect foreground via a luma threshold, blur the
 * resulting mask, write to alpha. Soft-cuts the subject out of its
 * background in one pass. Uses a luma cutoff because it's the most
 * forgiving default — works for both transparent PNGs (alpha picks
 * up the cutout naturally) and opaque images with bright backdrops.
 *
 * For tighter control the user should use the dedicated Background
 * removal effect (with its own chroma/luma + softness sliders); this
 * mode is the "I just want a feathered cutout" shortcut.
 */
function featherObject(src: ImageData, radius: number): ImageData {
  const r = Math.max(1, Math.min(40, Math.round(radius)));
  const w = src.width;
  const h = src.height;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);

  // Build foreground mask. Pixel is foreground if it has non-trivial
  // alpha AND its luma differs from the four-corner average by more
  // than a small tolerance. Tolerance scales with the radius so larger
  // feathers also enlarge the "considered foreground" band.
  let kr = 0;
  let kg = 0;
  let kb = 0;
  let kn = 0;
  const samples: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  for (const [px, py] of samples) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.min(w - 1, Math.max(0, px + dx));
        const yy = Math.min(h - 1, Math.max(0, py + dy));
        const i = (yy * w + xx) * 4;
        kr += src.data[i];
        kg += src.data[i + 1];
        kb += src.data[i + 2];
        kn += 1;
      }
    }
  }
  kr /= kn;
  kg /= kn;
  kb /= kn;
  const tolSq = 32 * 32; // generous default — feather softens the edge anyway

  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src.data[i + 3] < 8) {
        mask[y * w + x] = 0;
        continue;
      }
      const dr = src.data[i] - kr;
      const dg = src.data[i + 1] - kg;
      const db = src.data[i + 2] - kb;
      mask[y * w + x] = dr * dr + dg * dg + db * db > tolSq ? 255 : 0;
    }
  }

  // Two-pass box-blur the mask. Output alpha = (original alpha * mask)/255
  // so anywhere the mask is 0 becomes transparent and the original alpha
  // is otherwise preserved (so semi-transparent input pixels still feel
  // right inside the object).
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -r; k <= r; k++) {
        const sx = x + k;
        if (sx < 0 || sx >= w) continue;
        sum += mask[y * w + sx];
        cnt += 1;
      }
      tmp[y * w + x] = sum / cnt;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -r; k <= r; k++) {
        const sy = y + k;
        if (sy < 0 || sy >= h) continue;
        sum += tmp[sy * w + x];
        cnt += 1;
      }
      const m = sum / cnt;
      const i = (y * w + x) * 4 + 3;
      out.data[i] = clamp8((src.data[i] * m) / 255);
    }
  }
  return out;
}

function featherAlpha(src: ImageData, radius: number): ImageData {
  const r = Math.max(1, Math.min(20, Math.round(radius)));
  const w = src.width;
  const h = src.height;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = src.data[i * 4 + 3];
  // Simple box-blur on alpha — two passes approximates a Gaussian
  // close enough for a UX feather. Cost is O(w*h*r) per axis.
  const tmp = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -r; k <= r; k++) {
        const sx = x + k;
        if (sx < 0 || sx >= w) continue;
        sum += a[y * w + sx];
        cnt += 1;
      }
      tmp[y * w + x] = sum / cnt;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -r; k <= r; k++) {
        const sy = y + k;
        if (sy < 0 || sy >= h) continue;
        sum += tmp[sy * w + x];
        cnt += 1;
      }
      out.data[(y * w + x) * 4 + 3] = clamp8(sum / cnt);
    }
  }
  return out;
}

function clamp8(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

/**
 * Map a click on the displayed (post-rotate, post-flip) preview
 * canvas back to a pixel on the source image.
 *
 * The forward render in `drawTransformed` is:
 *   translate(sw/2, sh/2) ∘ rotate(r) ∘ scale(flip) ∘ translate(-srcW/2, -srcH/2)
 * where (sw, sh) is the rotated canvas size and (srcW, srcH) is the
 * source-image size. This is the inverse: undo the outer translate,
 * unrotate, unflip, then re-center on the source image's top-left.
 */
function displayToSource(
  dx: number,
  dy: number,
  srcW: number,
  srcH: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
): { x: number; y: number } {
  const rotated = rotation % 180 !== 0;
  const sw = rotated ? srcH : srcW;
  const sh = rotated ? srcW : srcH;
  // Step 1: translate display so canvas center is origin.
  let x = dx - sw / 2;
  let y = dy - sh / 2;
  // Step 2: inverse-rotate.
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  x = rx;
  y = ry;
  // Step 3: inverse-flip.
  if (flipH) x = -x;
  if (flipV) y = -y;
  // Step 4: translate back so source top-left is origin.
  return { x: x + srcW / 2, y: y + srcH / 2 };
}

/**
 * Paint an eraser dab on `canvas` at source-pixel (x, y) with the
 * given radius. Hardness (0..1) controls the falloff: 1 is a hard
 * disc, 0 is a soft radial gradient. Uses `destination-out`
 * composite so the dab subtracts alpha rather than overwriting RGB.
 *
 * When `selectionMask` is non-null the dab is clipped to the selection:
 * we paint a temporary mask layer, intersect it with the wand
 * selection, then composite the result against the working canvas.
 * That way an eraser stroke inside an active selection only takes a
 * bite out of the selected region — pixels outside stay intact even
 * if the brush crosses over them.
 */
function paintEraser(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  hardness: number,
  selectionMask: Uint8Array | null = null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const r = Math.max(1, radius);
  const h = Math.max(0, Math.min(1, hardness));
  if (!selectionMask) {
    // Fast path — no selection, paint directly into the working canvas.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(h, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Selection active — build the dab on an offscreen canvas, mask it
  // against the selection (alpha-blend in src-in), then knock the
  // result out of the working canvas. Two extra blits but it's
  // bounded to the dab's bounding rect so cost stays low.
  const w = canvas.width;
  const ht = canvas.height;
  if (selectionMask.length !== w * ht) {
    // Mismatched mask — fall back to unmasked so we don't silently
    // refuse to erase. Shouldn't happen in practice; the parent
    // guarantees the dims match.
    paintEraser(canvas, x, y, radius, hardness, null);
    return;
  }
  // Compute the bbox of the dab clipped to the canvas.
  const x0 = Math.max(0, Math.floor(x - r));
  const y0 = Math.max(0, Math.floor(y - r));
  const x1 = Math.min(w, Math.ceil(x + r));
  const y1 = Math.min(ht, Math.ceil(y + r));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  const dab = document.createElement("canvas");
  dab.width = bw;
  dab.height = bh;
  const dctx = dab.getContext("2d");
  if (!dctx) return;
  // 1. Paint the dab into the offscreen canvas at full opacity.
  const grad = dctx.createRadialGradient(x - x0, y - y0, 0, x - x0, y - y0, r);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(h, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  dctx.fillStyle = grad;
  dctx.beginPath();
  dctx.arc(x - x0, y - y0, r, 0, 2 * Math.PI);
  dctx.fill();
  // 2. Stamp the selection mask onto a second canvas — only pixels
  // where mask[i] == 1 land. Then composite the dab against the mask
  // using `source-in` so the dab survives only where the selection
  // permits.
  const maskImg = dctx.createImageData(bw, bh);
  const md = maskImg.data;
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const sx = x0 + xx;
      const sy = y0 + yy;
      if (selectionMask[sy * w + sx]) {
        const j = (yy * bw + xx) * 4;
        md[j] = 255;
        md[j + 1] = 255;
        md[j + 2] = 255;
        md[j + 3] = 255;
      }
    }
  }
  // putImageData ignores composite mode, so layer through an
  // intermediate canvas: paint the mask, then composite the dab with
  // source-in to clip.
  const masked = document.createElement("canvas");
  masked.width = bw;
  masked.height = bh;
  const mctx = masked.getContext("2d");
  if (!mctx) return;
  mctx.putImageData(maskImg, 0, 0);
  mctx.globalCompositeOperation = "source-in";
  mctx.drawImage(dab, 0, 0);
  // 3. Knock the masked dab out of the working canvas.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(masked, x0, y0);
  ctx.restore();
}

// Re-export so other consumers (and the canvas-overlay below) can
// reuse the no-op constant + the effect type.
export { effectsAreNoop, levelsAreNoop };

/* ====================================================================== */
/* Tiny presentation helpers                                               */
/* ====================================================================== */

const INPUT =
  "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{title}</p>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function ToolBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded border px-2 py-1.5 text-xs",
        active
          ? "border-accent-500/50 bg-accent-500/15 text-accent-300"
          : "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Vertical-palette icon button — square 36×36 tile with an icon
 * centered, optional active state, hover tooltip. Used by the
 * left-side tool palette to mirror paint.net's chrome.
 */
function PaletteBtn({
  label,
  icon,
  onClick,
  active,
  shortcut,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      className={[
        "flex h-9 w-9 items-center justify-center rounded border transition-colors",
        active
          ? "border-accent-500/60 bg-accent-500/20 text-accent-300"
          : "border-transparent text-ink-300 hover:border-ink-700 hover:bg-ink-800 hover:text-ink-100",
      ].join(" ")}
    >
      <span className="block h-5 w-5">{icon}</span>
    </button>
  );
}

function EffectSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  // Treat `0` as the off state for read-out, regardless of the min:
  // for negative-range knobs (brightness, hue) `0` is still "no
  // change" semantically, which is what users expect.
  const isOff = value === 0;
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-[11px] text-ink-300">
        <span>{label}</span>
        <span className={isOff ? "text-ink-500" : "tabular-nums text-accent-300"}>
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-800 accent-accent-500"
      />
    </label>
  );
}

/**
 * Visual slice editor — renders a scaled preview of the asset image
 * with overlay guide lines that can be dragged to set 9-slice or
 * 25-slice insets. Image-space pixel math mirrors the existing
 * AssetEditor's SliceImagePreview: the display box and natural image
 * dims give a scale factor; pointer deltas multiply through to land
 * on the right source pixel.
 *
 * Modes:
 *   • "nine"        → 4 draggable guides (top / right / bottom / left).
 *   • "twentyFive"  → 8 draggable guides (outer + inner per side).
 *
 * The numeric inputs above this component keep working — both the
 * sliders and the drag handles edit the same state, so users can
 * scrub visually and fine-tune by typing.
 */
type Slice9 = { top: number; right: number; bottom: number; left: number };
type Slice25 = {
  outerTop: number;
  outerRight: number;
  outerBottom: number;
  outerLeft: number;
  innerTop: number;
  innerRight: number;
  innerBottom: number;
  innerLeft: number;
};

function SliceDragEditor(props:
  | {
      image: HTMLImageElement;
      mode: "nine";
      slice9: Slice9;
      onSlice9: (s: Slice9) => void;
    }
  | {
      image: HTMLImageElement;
      mode: "twentyFive";
      slice25: Slice25;
      onSlice25: (s: Slice25) => void;
    }
) {
  const { image, mode } = props;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Re-measure on load + on resize. ResizeObserver beats `onLoad`
  // because the preview is constrained by max-width, and the box
  // changes when the surrounding panel resizes.
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const naturalW = image.naturalWidth;
  const naturalH = image.naturalHeight;
  const ready = box.w > 0 && box.h > 0;

  // Helper: convert px in source-image space → px in display space.
  const sx = ready ? box.w / naturalW : 1;
  const sy = ready ? box.h / naturalH : 1;

  /**
   * Begin a drag on a guide. `axis` picks which dim to read from the
   * pointer delta, `apply` runs against the starting slice snapshot
   * and returns the new slice. Caller fires the appropriate setter.
   */
  function startDrag<S>(
    initial: S,
    axis: "x" | "y",
    apply: (snap: S, deltaPx: number) => S,
    setter: (s: S) => void,
  ) {
    return (e: React.PointerEvent<SVGRectElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      function onMove(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / sx;
        const dy = (ev.clientY - startY) / sy;
        setter(apply(initial, axis === "x" ? dx : dy));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  // Compute guide pixel positions in DISPLAY space for each cut.
  const lines: Array<{
    kind: "h" | "v";
    /** display-space coord along the perpendicular axis */
    pos: number;
    /** key used for React + handler dispatch */
    id: string;
    /** outer vs inner ring (just styles differently) */
    style: "outer" | "inner";
  }> = [];
  if (mode === "nine") {
    const s = props.slice9;
    lines.push({ kind: "h", pos: s.top * sy, id: "top", style: "outer" });
    lines.push({
      kind: "h",
      pos: box.h - s.bottom * sy,
      id: "bottom",
      style: "outer",
    });
    lines.push({ kind: "v", pos: s.left * sx, id: "left", style: "outer" });
    lines.push({
      kind: "v",
      pos: box.w - s.right * sx,
      id: "right",
      style: "outer",
    });
  } else {
    const s = props.slice25;
    lines.push({ kind: "h", pos: s.outerTop * sy, id: "outerTop", style: "outer" });
    lines.push({
      kind: "h",
      pos: box.h - s.outerBottom * sy,
      id: "outerBottom",
      style: "outer",
    });
    lines.push({ kind: "v", pos: s.outerLeft * sx, id: "outerLeft", style: "outer" });
    lines.push({
      kind: "v",
      pos: box.w - s.outerRight * sx,
      id: "outerRight",
      style: "outer",
    });
    lines.push({ kind: "h", pos: s.innerTop * sy, id: "innerTop", style: "inner" });
    lines.push({
      kind: "h",
      pos: box.h - s.innerBottom * sy,
      id: "innerBottom",
      style: "inner",
    });
    lines.push({ kind: "v", pos: s.innerLeft * sx, id: "innerLeft", style: "inner" });
    lines.push({
      kind: "v",
      pos: box.w - s.innerRight * sx,
      id: "innerRight",
      style: "inner",
    });
  }

  // Dispatcher — pick a drag function per line.
  function pointerDownFor(line: (typeof lines)[number]) {
    if (mode === "nine") {
      const snap = { ...props.slice9 };
      const set = props.onSlice9;
      const clamp = (v: number, max: number) =>
        Math.max(0, Math.min(max, Math.round(v)));
      if (line.id === "top") {
        return startDrag(snap, "y", (s, dy) => ({
          ...s,
          top: clamp(s.top + dy, naturalH - s.bottom - 1),
        }), set);
      }
      if (line.id === "bottom") {
        return startDrag(snap, "y", (s, dy) => ({
          ...s,
          bottom: clamp(s.bottom - dy, naturalH - s.top - 1),
        }), set);
      }
      if (line.id === "left") {
        return startDrag(snap, "x", (s, dx) => ({
          ...s,
          left: clamp(s.left + dx, naturalW - s.right - 1),
        }), set);
      }
      // right
      return startDrag(snap, "x", (s, dx) => ({
        ...s,
        right: clamp(s.right - dx, naturalW - s.left - 1),
      }), set);
    }
    // 25-slice: same shape but with the inner/outer ≥ pairing rule
    // enforced — drag the outer below the inner and the inner follows,
    // drag the inner above the outer and the outer follows.
    const snap = { ...props.slice25 };
    const set = props.onSlice25;
    const clamp = (v: number, max: number) =>
      Math.max(0, Math.min(max, Math.round(v)));
    function fix(s: Slice25): Slice25 {
      const n = { ...s };
      if (n.innerTop < n.outerTop) n.innerTop = n.outerTop;
      if (n.innerBottom < n.outerBottom) n.innerBottom = n.outerBottom;
      if (n.innerLeft < n.outerLeft) n.innerLeft = n.outerLeft;
      if (n.innerRight < n.outerRight) n.innerRight = n.outerRight;
      return n;
    }
    switch (line.id) {
      case "outerTop":
        return startDrag(snap, "y", (s, dy) =>
          fix({ ...s, outerTop: clamp(s.outerTop + dy, naturalH / 2 - 1) }),
          set);
      case "innerTop":
        return startDrag(snap, "y", (s, dy) =>
          fix({ ...s, innerTop: clamp(s.innerTop + dy, naturalH - s.outerBottom - 1) }),
          set);
      case "outerBottom":
        return startDrag(snap, "y", (s, dy) =>
          fix({ ...s, outerBottom: clamp(s.outerBottom - dy, naturalH / 2 - 1) }),
          set);
      case "innerBottom":
        return startDrag(snap, "y", (s, dy) =>
          fix({ ...s, innerBottom: clamp(s.innerBottom - dy, naturalH - s.outerTop - 1) }),
          set);
      case "outerLeft":
        return startDrag(snap, "x", (s, dx) =>
          fix({ ...s, outerLeft: clamp(s.outerLeft + dx, naturalW / 2 - 1) }),
          set);
      case "innerLeft":
        return startDrag(snap, "x", (s, dx) =>
          fix({ ...s, innerLeft: clamp(s.innerLeft + dx, naturalW - s.outerRight - 1) }),
          set);
      case "outerRight":
        return startDrag(snap, "x", (s, dx) =>
          fix({ ...s, outerRight: clamp(s.outerRight - dx, naturalW / 2 - 1) }),
          set);
      case "innerRight":
        return startDrag(snap, "x", (s, dx) =>
          fix({ ...s, innerRight: clamp(s.innerRight - dx, naturalW - s.outerLeft - 1) }),
          set);
    }
    return undefined;
  }

  return (
    <div className="my-2 space-y-1">
      <div
        className="relative overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,transparent_0%_50%)] [background-size:12px_12px]"
        style={{ maxHeight: 200 }}
      >
      <img
        ref={imgRef}
        src={image.src}
        alt=""
        draggable={false}
        className="block h-auto w-full max-h-[200px] object-contain"
      />
      {ready && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={box.w}
          height={box.h}
          viewBox={`0 0 ${box.w} ${box.h}`}
        >
          {/* Cell-color overlay. For 25-slice mode we paint each of
              the 25 cells with a hue that distinguishes static cells
              (the 4 corners + 4 mid-edge centers) from cells that
              stretch on X, on Y, or both. Makes the layout legible at
              a glance — without this, "drag the line" feedback didn't
              tell the user which regions would stay sharp. */}
          {mode === "twentyFive" && cellRects(props.slice25, naturalW, naturalH, sx, sy).map((c) => (
            <rect
              key={c.id}
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              fill={c.fill}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.5}
            />
          ))}
          {mode === "nine" && cellRects9(props.slice9, naturalW, naturalH, sx, sy).map((c) => (
            <rect
              key={c.id}
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              fill={c.fill}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.5}
            />
          ))}
          {lines.map((line) => {
            const stroke =
              line.style === "outer"
                ? "rgba(212,162,76,0.95)"
                : "rgba(235,209,152,0.85)";
            const dash = line.style === "inner" ? "3 2" : undefined;
            // 8px-wide hit area centered on the guide for easier grabbing.
            const handler = pointerDownFor(line);
            return (
              <g key={line.id}>
                {line.kind === "h" ? (
                  <>
                    <line
                      x1={0}
                      x2={box.w}
                      y1={line.pos}
                      y2={line.pos}
                      stroke={stroke}
                      strokeWidth={1}
                      strokeDasharray={dash}
                    />
                    <rect
                      x={0}
                      y={line.pos - 4}
                      width={box.w}
                      height={8}
                      fill="transparent"
                      style={{ cursor: "ns-resize", pointerEvents: "auto" }}
                      onPointerDown={handler}
                    />
                  </>
                ) : (
                  <>
                    <line
                      x1={line.pos}
                      x2={line.pos}
                      y1={0}
                      y2={box.h}
                      stroke={stroke}
                      strokeWidth={1}
                      strokeDasharray={dash}
                    />
                    <rect
                      x={line.pos - 4}
                      y={0}
                      width={8}
                      height={box.h}
                      fill="transparent"
                      style={{ cursor: "ew-resize", pointerEvents: "auto" }}
                      onPointerDown={handler}
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      )}
      </div>
      {/* Color legend — explains the cell overlay so the user knows
          what each tint means before they start dragging. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-400">
        <LegendSwatch color={CELL_STATIC_FILL} label="Static (source size)" />
        <LegendSwatch color={CELL_STRETCH_X_FILL} label="Stretch X" />
        <LegendSwatch color={CELL_STRETCH_Y_FILL} label="Stretch Y" />
        <LegendSwatch color={CELL_STRETCH_BOTH_FILL} label="Stretch both" />
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-sm border border-white/10"
        style={{ background: color }}
      />
      <span>{label}</span>
    </span>
  );
}

/* ----- Cell color palette for the slice preview ------------------------- */

const CELL_STATIC_FILL = "rgba(212, 162, 76, 0.32)"; // brass — corners + edge centers, never moves
const CELL_STRETCH_X_FILL = "rgba(82, 168, 95, 0.22)"; // moss — stretches horizontally
const CELL_STRETCH_Y_FILL = "rgba(93, 156, 236, 0.22)"; // sky — stretches vertically
const CELL_STRETCH_BOTH_FILL = "rgba(167, 119, 224, 0.22)"; // amethyst — stretches both axes

interface CellRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/**
 * Layout the 25 cells of a 25-slice config into display-space rects
 * with each cell colored by its stretch policy. Mirrors the canvas
 * renderer's rule exactly so the preview is honest:
 *
 *   • cols (left → right): outerL  innerL-stripe  midW  innerR-stripe  outerR
 *   • rows mirror the column layout vertically
 *   • static cells:
 *       (0,0)(0,2)(0,4)(4,0)(4,2)(4,4) — top/bottom corners + centers
 *       (2,0)(2,4)                     — left/right centers
 *   • everything else stretches on the axes its col/row stretches.
 */
function cellRects(
  s: Slice25,
  natW: number,
  natH: number,
  sx: number,
  sy: number,
): CellRect[] {
  const innerLeftStripe = Math.max(0, s.innerLeft - s.outerLeft);
  const innerRightStripe = Math.max(0, s.innerRight - s.outerRight);
  const midW = Math.max(0, natW - s.outerLeft - innerLeftStripe - s.outerRight - innerRightStripe);
  const colWidths = [s.outerLeft, innerLeftStripe, midW, innerRightStripe, s.outerRight];
  const innerTopStripe = Math.max(0, s.innerTop - s.outerTop);
  const innerBotStripe = Math.max(0, s.innerBottom - s.outerBottom);
  const midH = Math.max(0, natH - s.outerTop - innerTopStripe - s.outerBottom - innerBotStripe);
  const rowHeights = [s.outerTop, innerTopStripe, midH, innerBotStripe, s.outerBottom];

  // Prefix sums for cell origins.
  const xs: number[] = [0];
  for (const w of colWidths) xs.push(xs[xs.length - 1] + w);
  const ys: number[] = [0];
  for (const h of rowHeights) ys.push(ys[ys.length - 1] + h);

  const out: CellRect[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const fill = classify25(r, c);
      out.push({
        id: `${r}-${c}`,
        x: xs[c] * sx,
        y: ys[r] * sy,
        w: colWidths[c] * sx,
        h: rowHeights[r] * sy,
        fill,
      });
    }
  }
  return out;
}

function classify25(r: number, c: number): string {
  // Static — 4 outer corners + 4 mid-edge centers.
  const cornerR = r === 0 || r === 4;
  const cornerC = c === 0 || c === 4;
  if (cornerR && cornerC) return CELL_STATIC_FILL; // outer corner
  if (cornerR && c === 2) return CELL_STATIC_FILL; // top / bottom center
  if (r === 2 && cornerC) return CELL_STATIC_FILL; // left / right center

  // Stretch direction: a cell stretches X if its column is "inner"
  // (1 or 3) OR if its row 2 cell shares the middle column (col 2
  // is fixed-width, so col 2 stretch happens only when row 2; row 2
  // also stretches vertically though, so (2,2) ends up Both).
  const stretchX = c === 1 || c === 3;
  const stretchY = r === 1 || r === 3;
  // Special middle band: row 2 and col 2. Row 2 contains static cells
  // at (2,0)/(2,4) (caught above) and stretching cells at (2,1)(2,2)(2,3).
  // (2,1) and (2,3) sit in inner-stripe cols, so they take X slack.
  // (2,2) sits in mid col + mid row — both axes stretch.
  const rowMid = r === 2;
  const colMid = c === 2;

  if (rowMid && colMid) return CELL_STRETCH_BOTH_FILL; // (2,2) — dead center, full stretch
  if (stretchX && stretchY) return CELL_STRETCH_BOTH_FILL; // inner-corner cells
  if (stretchX || (rowMid && (c === 1 || c === 3))) return CELL_STRETCH_X_FILL;
  if (stretchY || (colMid && (r === 1 || r === 3))) return CELL_STRETCH_Y_FILL;
  // Shouldn't reach here, but fall back to "both" rather than blank.
  return CELL_STRETCH_BOTH_FILL;
}

/**
 * Same idea for 9-slice — color each of the 9 cells. Static = 4
 * corners only. Edges stretch one axis; center stretches both. Used
 * to keep the editor visualization consistent with 25-slice.
 */
function cellRects9(
  s: Slice9,
  natW: number,
  natH: number,
  sx: number,
  sy: number,
): CellRect[] {
  const midW = Math.max(0, natW - s.left - s.right);
  const midH = Math.max(0, natH - s.top - s.bottom);
  const colWidths = [s.left, midW, s.right];
  const rowHeights = [s.top, midH, s.bottom];
  const xs: number[] = [0];
  for (const w of colWidths) xs.push(xs[xs.length - 1] + w);
  const ys: number[] = [0];
  for (const h of rowHeights) ys.push(ys[ys.length - 1] + h);

  const out: CellRect[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const isCorner = (r === 0 || r === 2) && (c === 0 || c === 2);
      const stretchX = c === 1;
      const stretchY = r === 1;
      const fill = isCorner
        ? CELL_STATIC_FILL
        : stretchX && stretchY
          ? CELL_STRETCH_BOTH_FILL
          : stretchX
            ? CELL_STRETCH_X_FILL
            : CELL_STRETCH_Y_FILL;
      out.push({
        id: `${r}-${c}`,
        x: xs[c] * sx,
        y: ys[r] * sy,
        w: colWidths[c] * sx,
        h: rowHeights[r] * sy,
        fill,
      });
    }
  }
  return out;
}

