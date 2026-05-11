import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer as KLayer,
  Line,
  Rect,
  Text,
  TextPath as KTextPath,
  Group,
  Transformer,
  Image as KImage,
} from "react-konva";
import type { NineSlice, TwentyFiveSlice } from "@/types";
import type Konva from "konva";
import { useDesigner } from "@/store/designerStore";
import type { Layer } from "@/types";
import { exportPngBus } from "@/lib/exportPngBus";
import { exportCanvasToPng } from "@/lib/exportPng";
import { evaluateApplies, resolveLayer } from "@/lib/variants";
import { parentVisibilityGated } from "@/lib/groups";
import { resolveAssetUrl } from "@/lib/api";

/**
 * The canvas — Konva-backed.
 *
 * Coordinate system:
 *   • Stage handles pan/zoom — its `scale` and `position` come from the
 *     designer's viewport state in the store.
 *   • Inside the stage, the card design lives at world (0,0). All layers
 *     specify `bounds` in card space. The translation from card space to
 *     screen space is the Stage scale + position.
 *
 * Layers (in Konva sense — distinct from card layers):
 *   • cardLayer       — render target for export. Holds card background and
 *                        every visible card layer. id = `card-export`.
 *   • overlaysLayer   — bleed / safe-zone / grid guides + the Transformer.
 *                        Excluded from PNG export.
 *
 * Selection / interaction:
 *   • Click on a card layer node selects it.
 *   • Click on empty stage deselects.
 *   • Each card layer's draggable flag = !locked.
 *   • A Transformer in overlaysLayer attaches to the selected node so resize
 *     and rotate work without us authoring custom handles.
 */

const CARD_EXPORT_LAYER_ID = "card-export";
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const ZOOM_FACTOR = 1.1;

export function CanvasStage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const template = useDesigner((s) => s.template);
  const viewport = useDesigner((s) => s.viewport);
  const overlays = useDesigner((s) => s.overlays);
  const selectedLayerIds = useDesigner((s) => s.selectedLayerIds);
  const selectLayer = useDesigner((s) => s.selectLayer);
  const updateLayer = useDesigner((s) => s.updateLayer);
  const setViewport = useDesigner((s) => s.setViewport);
  const commit = useDesigner((s) => s.commit);

  // ----- container sizing -----
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ----- Transformer attaches to whichever nodes are selected -----
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    if (selectedLayerIds.length === 0) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    // Map ids → Konva nodes, dropping any that don't exist (e.g. just-deleted
    // layers still in the selection set for one render frame).
    const nodes = selectedLayerIds
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is import("konva").default.Node => Boolean(n));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedLayerIds, template.layers]);

  // ----- export bus subscription -----
  useEffect(() => {
    return exportPngBus.on("export", () => {
      const stage = stageRef.current;
      if (!stage) return;
      // Detach the transformer briefly so its handles don't leak into the export.
      const t = transformerRef.current;
      const previous = t?.nodes() ?? [];
      t?.nodes([]);
      t?.getLayer()?.batchDraw();
      try {
        exportCanvasToPng(stage, CARD_EXPORT_LAYER_ID, template);
      } finally {
        t?.nodes(previous);
        t?.getLayer()?.batchDraw();
      }
    });
  }, [template]);

  // ----- wheel zoom (centered on pointer) -----
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const candidate = direction > 0 ? oldScale * ZOOM_FACTOR : oldScale / ZOOM_FACTOR;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, candidate));
    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }

  // ----- click empty area to deselect -----
  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.target === e.target.getStage()) {
      // Shift/Ctrl-clicking the empty area preserves the existing selection
      // — matches the convention in most editors.
      if (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey) return;
      selectLayer(null);
    }
  }

  // ----- pan: only when grabbing the stage background, not a layer -----
  function handleStageDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    if (e.target !== e.target.getStage()) return;
    const stage = e.target as Konva.Stage;
    setViewport({
      scale: stage.scaleX(),
      x: stage.x(),
      y: stage.y(),
    });
  }

  // ----- guides geometry -----
  const guides = useMemo(() => {
    const { width: w, height: h } = template.size;
    const bleed = template.bleed;
    const safe = template.safeZone;
    const gridStep = 50;
    const dots: Array<{ x: number; y: number }> = [];
    for (let y = 0; y <= h; y += gridStep) {
      for (let x = 0; x <= w; x += gridStep) {
        dots.push({ x, y });
      }
    }
    return { w, h, bleed, safe, gridDots: dots };
  }, [template.size, template.bleed, template.safeZone]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
        backgroundSize: "12px 12px",
      }}
    >
      {size.w > 0 && size.h > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          x={viewport.x}
          y={viewport.y}
          draggable
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onDragEnd={handleStageDragEnd}
        >
          {/* Card content — exportable layer. */}
          <KLayer id={CARD_EXPORT_LAYER_ID}>
            {/* Card background. Drawn first so layers paint on top. */}
            <Rect
              x={0}
              y={0}
              width={guides.w}
              height={guides.h}
              fill={template.background}
              listening={false}
            />
            {template.layers.map((layer) => {
              // Groups never draw — they're organizational nodes in the
              // tree. Their visibility / appliesWhen is applied to
              // descendants via parentVisibilityGated below.
              if (layer.type === "group") return null;
              if (!layer.visible) return null;
              // Variant filter: layers with an unmet `appliesWhen` rule are
              // skipped entirely — including from the export. Selected layers
              // are still rendered so the user can edit the rule that's
              // hiding them, otherwise selecting a hidden variant would feel
              // like nothing happened.
              const variantApplies = evaluateApplies(
                layer.appliesWhen,
                template.previewData ?? {},
              );
              const isSelected = selectedLayerIds.includes(layer.id);
              if (!variantApplies && !isSelected) return null;
              // Parent group cascade — same exception for selected layers
              // so the user can find them again to fix the gating rule.
              if (
                parentVisibilityGated(layer, template.layers, template.previewData ?? {}) &&
                !isSelected
              ) {
                return null;
              }
              // Apply per-layer variant overrides before drawing so frame
              // art / fills / strokes / text all swap based on preview data.
              // Edits via the canvas (drag, transform) still commit against
              // the BASE layer — overrides are renderer-only by design.
              const resolved = resolveLayer(layer, template.previewData ?? {});
              return (
                <CardLayerNode
                  key={layer.id}
                  layer={resolved}
                  isSelected={isSelected}
                  fadeForVariant={!variantApplies}
                  onSelect={(e) =>
                    selectLayer(layer.id, e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "replace")
                  }
                  onChange={(patch) => updateLayer(layer.id, patch)}
                  onGestureStart={commit}
                />
              );
            })}
          </KLayer>

          {/* Guide overlays. listening=false on visuals so clicks pass through. */}
          <KLayer>
            {overlays.bleed && (
              <>
                <Rect
                  x={-guides.bleed}
                  y={-guides.bleed}
                  width={guides.w + guides.bleed * 2}
                  height={guides.h + guides.bleed * 2}
                  stroke="#e25c5c"
                  strokeWidth={1.5}
                  dash={[8, 6]}
                  listening={false}
                />
                {/* Corner crop marks at the bleed edge — printers cut along
                 *  these. Each corner gets two short orthogonal lines
                 *  extending past the bleed by `crop` pixels. */}
                {(() => {
                  const b = guides.bleed;
                  const w = guides.w;
                  const h = guides.h;
                  const crop = Math.max(12, b * 0.5);
                  const stroke = "#e25c5c";
                  const sw = 1.5;
                  const corners: Array<[number, number, number, number]> = [
                    // Top-left corner (two segments)
                    [-b - crop, -b, -b, -b],
                    [-b, -b - crop, -b, -b],
                    // Top-right
                    [w + b, -b, w + b + crop, -b],
                    [w + b, -b - crop, w + b, -b],
                    // Bottom-left
                    [-b - crop, h + b, -b, h + b],
                    [-b, h + b, -b, h + b + crop],
                    // Bottom-right
                    [w + b, h + b, w + b + crop, h + b],
                    [w + b, h + b, w + b, h + b + crop],
                  ];
                  return corners.map((pts, i) => (
                    <Line
                      key={`crop-${i}`}
                      points={pts as number[]}
                      stroke={stroke}
                      strokeWidth={sw}
                      listening={false}
                    />
                  ));
                })()}
                {/* Dimension label below the bottom-right crop mark.
                 *  Shows pixel size + computed inches when DPI is set. */}
                <Text
                  x={guides.w + guides.bleed - 64}
                  y={guides.h + guides.bleed + 8}
                  width={120}
                  text={`${guides.w}×${guides.h}px${
                    template.dpi
                      ? ` · ${(guides.w / template.dpi).toFixed(2)}″ × ${(guides.h / template.dpi).toFixed(2)}″`
                      : ""
                  }`}
                  fontSize={11}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill="rgba(255,255,255,0.55)"
                  listening={false}
                />
              </>
            )}
            {overlays.safeZone && (
              <Rect
                x={guides.safe}
                y={guides.safe}
                width={guides.w - guides.safe * 2}
                height={guides.h - guides.safe * 2}
                stroke="#54d99e"
                strokeWidth={1.2}
                dash={[6, 6]}
                listening={false}
              />
            )}
            {overlays.grid &&
              guides.gridDots.map((d, i) => (
                <Rect
                  key={i}
                  x={d.x - 0.5}
                  y={d.y - 0.5}
                  width={1}
                  height={1}
                  fill="rgba(255,255,255,0.18)"
                  listening={false}
                />
              ))}
            <Transformer
              ref={transformerRef}
              ignoreStroke
              rotateEnabled
              keepRatio={false}
              borderStroke="#d4a24c"
              anchorStroke="#d4a24c"
              anchorFill="#11141a"
              anchorSize={8}
              boundBoxFunc={(_oldBox, newBox) => {
                // Prevent inverted / zero-sized bounding boxes.
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return _oldBox;
                }
                return newBox;
              }}
            />
          </KLayer>
        </Stage>
      )}

      <ZoomReadout />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Per-layer node                                                         */
/* ---------------------------------------------------------------------- */

interface CardLayerNodeProps {
  layer: Layer;
  isSelected: boolean;
  /**
   * If true, the layer's variant rule says it shouldn't apply right now.
   * We still render it (it's the selected layer, so the user wants feedback),
   * but at very low opacity so the canvas tells the truth about what'll export.
   */
  fadeForVariant: boolean;
  /** Receives the underlying mouse / touch event so callers can read shift/ctrl. */
  onSelect: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onChange: (patch: Partial<Layer>) => void;
  /** Fired once at the start of any gesture so the store can snapshot history. */
  onGestureStart: () => void;
}

function CardLayerNode({
  layer,
  fadeForVariant,
  onSelect,
  onChange,
  onGestureStart,
}: CardLayerNodeProps) {
  // Common drag end → write back into the store.
  const commonHandlers = {
    id: layer.id,
    name: layer.name,
    draggable: !layer.locked,
    rotation: layer.rotation,
    opacity: fadeForVariant ? Math.min(0.18, layer.opacity) : layer.opacity,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      onSelect({
        shiftKey: e.evt.shiftKey,
        ctrlKey: e.evt.ctrlKey,
        metaKey: e.evt.metaKey,
      });
    },
    onTap: (e: Konva.KonvaEventObject<TouchEvent>) => {
      e.cancelBubble = true;
      onSelect({ shiftKey: false, ctrlKey: false, metaKey: false });
    },
    onDragStart: () => onGestureStart(),
    onTransformStart: () => onGestureStart(),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      onChange({
        bounds: {
          ...layer.bounds,
          x: Math.round(node.x()),
          y: Math.round(node.y()),
        },
      } as Partial<Layer>);
    },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      // Konva applies scale via scaleX/scaleY during transform — we bake it
      // back into width/height so future renders stay clean.
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      onChange({
        bounds: {
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: Math.max(5, Math.round(layer.bounds.width * scaleX)),
          height: Math.max(5, Math.round(layer.bounds.height * scaleY)),
        },
        rotation: Math.round(node.rotation()),
      } as Partial<Layer>);
    },
  };

  switch (layer.type) {
    case "rect":
      return (
        <Rect
          {...commonHandlers}
          x={layer.bounds.x}
          y={layer.bounds.y}
          width={layer.bounds.width}
          height={layer.bounds.height}
          fill={layer.fill}
          stroke={layer.stroke ?? undefined}
          strokeWidth={layer.strokeWidth}
          cornerRadius={layer.cornerRadius}
        />
      );

    case "text":
      // Path-bound text uses Konva.TextPath, which flows glyphs along
      // the supplied SVG path data. We re-anchor the path's origin to
      // the layer's bounds so authors can author paths in local coords
      // (matching the SVG renderer + the inspector's preset paths).
      if (layer.pathData) {
        return (
          <KTextPath
            {...commonHandlers}
            x={layer.bounds.x}
            y={layer.bounds.y}
            data={layer.pathData}
            text={layer.text}
            fill={layer.fill}
            fontFamily={layer.fontFamily}
            fontSize={layer.fontSize}
            fontStyle={layer.fontStyle}
            align={
              // Konva.TextPath supports "left" | "center" | "right". Map
              // ours through unchanged.
              layer.align
            }
          />
        );
      }
      return (
        <Text
          {...commonHandlers}
          x={layer.bounds.x}
          y={layer.bounds.y}
          width={layer.bounds.width}
          height={layer.bounds.height}
          text={layer.text}
          fill={layer.fill}
          fontFamily={layer.fontFamily}
          fontSize={layer.fontSize}
          fontStyle={layer.fontStyle}
          align={layer.align}
          verticalAlign={layer.verticalAlign}
          wrap={layer.wrap ? "word" : "none"}
        />
      );

    case "image":
      return <ImageLayerNode layer={layer} commonHandlers={commonHandlers} />;

    case "group":
      // Group layers never reach the canvas — they're filtered out before
      // CardLayerNode is invoked. This case keeps the type checker happy
      // for the discriminated union without adding render cost.
      return null;

    case "zone":
      // Render a dashed rectangle with a placeholder label. The tint helps
      // the designer feel "data-bound" while the box is empty in MVP.
      return (
        <Group {...commonHandlers} x={layer.bounds.x} y={layer.bounds.y}>
          <Rect
            x={0}
            y={0}
            width={layer.bounds.width}
            height={layer.bounds.height}
            fill={layer.designerTint}
            stroke="#d4a24c"
            strokeWidth={1}
            dash={[5, 4]}
            cornerRadius={3}
          />
          <Text
            x={6}
            y={4}
            width={layer.bounds.width - 12}
            text={`◧ ${layer.fieldKey}`}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize={11}
            fill="rgba(212, 162, 76, 0.9)"
            listening={false}
          />
          <Text
            x={6}
            y={Math.max(20, Math.min(layer.bounds.height / 2 - layer.fontSize / 2, layer.bounds.height - layer.fontSize - 6))}
            width={layer.bounds.width - 12}
            text={layer.placeholder}
            fontFamily={layer.fontFamily}
            fontSize={layer.fontSize}
            align={layer.align}
            fill={layer.fill}
            listening={false}
          />
        </Group>
      );
  }
}

/* ---------------------------------------------------------------------- */
/* Image layer with browser-side asset loading                            */
/* ---------------------------------------------------------------------- */

function ImageLayerNode({
  layer,
  commonHandlers,
}: {
  layer: Extract<Layer, { type: "image" }>;
  commonHandlers: Record<string, unknown>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const previewData = useDesigner((s) => s.template?.previewData);
  const currentUser = useDesigner((s) => s.currentUser);

  useEffect(() => {
    const src = resolveAssetUrl(layer, previewData ?? {});
    if (!src) {
      setImg(null);
      return;
    }

    const next = new window.Image();
    next.crossOrigin = "anonymous";
    next.onload = () => setImg(next);
    next.onerror = () => setImg(null);
    next.src = src;
    return () => {
      next.onload = null;
      next.onerror = null;
    };
  }, [layer, previewData, currentUser]);

  // No source — render a placeholder so the user sees the layer exists.
  if (!img) {
    return (
      <Group
        {...commonHandlers}
        x={layer.bounds.x}
        y={layer.bounds.y}
      >
        <Rect
          x={0}
          y={0}
          width={layer.bounds.width}
          height={layer.bounds.height}
          fill="rgba(58, 66, 88, 0.35)"
          stroke="rgba(212, 162, 76, 0.6)"
          strokeWidth={1}
          dash={[6, 5]}
        />
        <Text
          x={0}
          y={layer.bounds.height / 2 - 7}
          width={layer.bounds.width}
          text="(image)"
          align="center"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={12}
          fill="rgba(255,255,255,0.4)"
          listening={false}
        />
      </Group>
    );
  }

  // 25-slice wins over 9-slice when both are set — the renderer never
  // tries to combine them. Same fail-open behavior: if the image or
  // bounds can't accommodate the cuts, fall through to plain stretch.
  if (layer.slice25 && canSlice25(img, layer.bounds, layer.slice25)) {
    return (
      <TwentyFiveSliceImage
        image={img}
        slice={layer.slice25}
        bounds={layer.bounds}
        commonHandlers={commonHandlers}
      />
    );
  }

  // 9-slice path. Active when `layer.slice` is set AND the image + bounds
  // can actually accommodate the corner insets. Otherwise fall through to
  // plain stretch — better to render slightly wrong than not at all.
  if (layer.slice && canSlice(img, layer.bounds, layer.slice)) {
    return (
      <NineSliceImage
        image={img}
        slice={layer.slice}
        bounds={layer.bounds}
        commonHandlers={commonHandlers}
      />
    );
  }

  // Crop in source pixels — defaults to whole image. Used for both single-
  // instance and repeat fit modes.
  const crop = layer.crop ?? {
    x: 0,
    y: 0,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
  const offsetX = layer.offset?.x ?? 0;
  const offsetY = layer.offset?.y ?? 0;
  const { width: bw, height: bh } = layer.bounds;

  // Repeat fit — render a Rect with fillPatternImage. Konva natively tiles
  // an image into a rect's fill at the requested scale; that gives us the
  // pattern behaviour without shipping multiple Image nodes per tile.
  // The pattern source uses crop offsets via fillPatternX/Y on the *image*
  // (Konva multiplies sx/sy when sourceRect is set via cropX/cropY).
  // We use a clip-rect rather than nested groups so the bounds clip the
  // tiles cleanly without rotating with the layer.
  if (layer.fit === "repeat") {
    const tileScaleX = layer.tileScale?.x ?? 1;
    const tileScaleY = layer.tileScale?.y ?? 1;
    return (
      <Group
        {...commonHandlers}
        x={layer.bounds.x}
        y={layer.bounds.y}
        clipX={0}
        clipY={0}
        clipWidth={bw}
        clipHeight={bh}
      >
        {/* Konva doesn't expose a "crop the source before tiling" knob on
            Rect, so when a crop is requested we draw to an offscreen
            <canvas> and use that as the pattern source. For the no-crop
            case we pass the original image straight through, which is
            cheaper. */}
        <Rect
          x={0}
          y={0}
          width={bw}
          height={bh}
          fillPatternImage={
            (layer.crop ? buildCroppedPatternImage(img, layer.crop) : img) as any
          }
          fillPatternRepeat="repeat"
          fillPatternScaleX={tileScaleX}
          fillPatternScaleY={tileScaleY}
          fillPatternX={offsetX}
          fillPatternY={offsetY}
        />
      </Group>
    );
  }

  // Single-instance fit — compute the destination rect for the cropped
  // image given fit mode, then apply offset.
  const fitRect = computeFitRect(layer.fit, crop.width, crop.height, bw, bh);
  const cropProps = layer.crop
    ? { crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height } }
    : {};

  // Cover mode + offset can overflow the bounds; wrap in a clipping
  // group so the image never bleeds onto neighbouring layers. For
  // contain mode the fit rect is always inside bounds, but offset can
  // still push it past — same wrap is fine. Only "fill" with zero offset
  // is guaranteed to stay inside, but the wrap cost is negligible so we
  // always clip when there's any non-trivial fit.
  const needsClip =
    layer.fit !== "fill" || offsetX !== 0 || offsetY !== 0;

  if (!needsClip) {
    return (
      <KImage
        {...commonHandlers}
        image={img}
        x={layer.bounds.x + fitRect.x + offsetX}
        y={layer.bounds.y + fitRect.y + offsetY}
        width={fitRect.w}
        height={fitRect.h}
        {...cropProps}
      />
    );
  }
  return (
    <Group
      {...commonHandlers}
      x={layer.bounds.x}
      y={layer.bounds.y}
      clipX={0}
      clipY={0}
      clipWidth={bw}
      clipHeight={bh}
    >
      <KImage
        image={img}
        x={fitRect.x + offsetX}
        y={fitRect.y + offsetY}
        width={fitRect.w}
        height={fitRect.h}
        {...cropProps}
      />
    </Group>
  );
}

/**
 * Compute a "fit" destination rectangle inside `destW × destH` for a source
 * of `srcW × srcH`. Used by image layers in contain/cover/fill modes.
 */
function computeFitRect(
  fit: "contain" | "cover" | "fill" | "repeat",
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
): { x: number; y: number; w: number; h: number } {
  if (fit === "fill" || fit === "repeat") {
    // Repeat ends up using the rect path above, but for completeness.
    return { x: 0, y: 0, w: destW, h: destH };
  }
  // Aspect-preserving scale.
  const scale =
    fit === "contain"
      ? Math.min(destW / Math.max(1, srcW), destH / Math.max(1, srcH))
      : Math.max(destW / Math.max(1, srcW), destH / Math.max(1, srcH)); // cover
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (destW - w) / 2, y: (destH - h) / 2, w, h };
}

/**
 * Build an offscreen canvas containing only the cropped region of `src`,
 * then return a fresh HTMLCanvasElement we can hand to Konva as a pattern
 * fill. We could memoize per-(image,crop) but for typical cards this runs
 * ≤ once per layer per render, and changing crop is a re-render anyway.
 */
function buildCroppedPatternImage(
  src: HTMLImageElement,
  crop: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(
      src,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }
  return canvas;
}

function canSlice(
  img: HTMLImageElement,
  bounds: { width: number; height: number },
  slice: NineSlice,
): boolean {
  const cornersFitImage =
    slice.top + slice.bottom < img.naturalHeight &&
    slice.left + slice.right < img.naturalWidth;
  const cornersFitTarget =
    slice.top + slice.bottom <= bounds.height &&
    slice.left + slice.right <= bounds.width;
  return cornersFitImage && cornersFitTarget;
}

/**
 * Render a 9-slice image as a Konva Group of nine cropped <Image> nodes.
 *
 * Naming convention: 3 columns × 3 rows.
 *   columns: left | center | right
 *   rows:    top  | middle | bottom
 *
 * The Group inherits the position / drag / transform handlers from the
 * caller via `commonHandlers`, so 9-slice layers behave like any other
 * layer (selectable, draggable, transformer-resizable).
 */
function NineSliceImage({
  image,
  slice,
  bounds,
  commonHandlers,
}: {
  image: HTMLImageElement;
  slice: NineSlice;
  bounds: { x: number; y: number; width: number; height: number };
  commonHandlers: Record<string, unknown>;
}) {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;

  // Source columns: left | center | right (in image px).
  const srcLeftW = slice.left;
  const srcRightW = slice.right;
  const srcCenterW = Math.max(1, iw - srcLeftW - srcRightW);
  // Source rows: top | middle | bottom.
  const srcTopH = slice.top;
  const srcBotH = slice.bottom;
  const srcMidH = Math.max(1, ih - srcTopH - srcBotH);

  // Destination columns: left | center | right (in card px).
  const dstLeftW = slice.left;
  const dstRightW = slice.right;
  const dstCenterW = Math.max(0, bounds.width - dstLeftW - dstRightW);
  // Destination rows: top | middle | bottom.
  const dstTopH = slice.top;
  const dstBotH = slice.bottom;
  const dstMidH = Math.max(0, bounds.height - dstTopH - dstBotH);

  const slices: Array<{
    sx: number; sy: number; sw: number; sh: number;
    dx: number; dy: number; dw: number; dh: number;
    key: string;
  }> = [];

  const cols = [
    { sx: 0, sw: srcLeftW, dx: 0, dw: dstLeftW, k: "l" },
    { sx: srcLeftW, sw: srcCenterW, dx: dstLeftW, dw: dstCenterW, k: "c" },
    { sx: iw - srcRightW, sw: srcRightW, dx: bounds.width - dstRightW, dw: dstRightW, k: "r" },
  ];
  const rows = [
    { sy: 0, sh: srcTopH, dy: 0, dh: dstTopH, k: "t" },
    { sy: srcTopH, sh: srcMidH, dy: dstTopH, dh: dstMidH, k: "m" },
    { sy: ih - srcBotH, sh: srcBotH, dy: bounds.height - dstBotH, dh: dstBotH, k: "b" },
  ];

  for (const r of rows) {
    for (const c of cols) {
      // Skip slices with zero rendered size — happens when corner inset
      // exactly equals half the bounds, which leaves no center band.
      if (c.dw <= 0 || r.dh <= 0) continue;
      // Skip source slices with zero size (image too thin in that band).
      if (c.sw <= 0 || r.sh <= 0) continue;
      slices.push({
        sx: c.sx, sy: r.sy, sw: c.sw, sh: r.sh,
        dx: c.dx, dy: r.dy, dw: c.dw, dh: r.dh,
        key: `${r.k}-${c.k}`,
      });
    }
  }

  return (
    <Group {...commonHandlers} x={bounds.x} y={bounds.y}>
      {slices.map((s) => (
        <KImage
          key={s.key}
          image={image}
          x={s.dx}
          y={s.dy}
          width={s.dw}
          height={s.dh}
          crop={{ x: s.sx, y: s.sy, width: s.sw, height: s.sh }}
          listening={false}
        />
      ))}
    </Group>
  );
}

/* ---------------------------------------------------------------------- */
/* 25-slice                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Validate that a 25-slice config fits both the source image and the
 * rendered bounds. We refuse to render when any of:
 *   - outer + inner exceeds the source dimension on either axis (would
 *     leave no center band in the source)
 *   - outer + inner exceeds the destination bounds on either axis (the
 *     fixed cells alone don't fit in the rendered rect)
 *   - any inner inset is less than its matching outer (would invert
 *     the band order — nonsense)
 *
 * On failure, the caller falls back to 9-slice or plain stretch — we
 * never crash on a malformed config mid-edit.
 */
function canSlice25(
  img: HTMLImageElement,
  bounds: { width: number; height: number },
  s: TwentyFiveSlice,
): boolean {
  if (
    s.innerTop < s.outerTop ||
    s.innerBottom < s.outerBottom ||
    s.innerLeft < s.outerLeft ||
    s.innerRight < s.outerRight
  ) {
    return false;
  }
  const fixedV = s.outerTop + s.innerTop + s.outerBottom + s.innerBottom;
  const fixedH = s.outerLeft + s.innerLeft + s.outerRight + s.innerRight;
  return (
    fixedV < img.naturalHeight &&
    fixedH < img.naturalWidth &&
    fixedV <= bounds.height &&
    fixedH <= bounds.width
  );
}

/**
 * Render a 25-slice image as a Konva Group of up to 25 cropped <Image>
 * nodes. Mirrors the 9-slice approach but with 5 columns × 5 rows.
 *
 * Stretch policy (per the spec on TwentyFiveSlice):
 *   • Cells at (row, col) where row ∈ {0,4} AND col ∈ {0,4} → fixed.
 *   • Cells where row ∈ {1,3} AND col ∈ {1,3}              → fixed.
 *   • Cell (2,2) (dead center)                              → fixed.
 *   • Everything else stretches along the axis it lives on
 *     (outer/inner edge stripes + inner rails).
 *
 * Because no cell stretches both axes, the interior is filled by
 * whatever layers sit behind this image — exactly the "fancy frame
 * around a card" use case the user asked for.
 */
function TwentyFiveSliceImage({
  image,
  slice,
  bounds,
  commonHandlers,
}: {
  image: HTMLImageElement;
  slice: TwentyFiveSlice;
  bounds: { x: number; y: number; width: number; height: number };
  commonHandlers: Record<string, unknown>;
}) {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;

  // Source column widths (5 stripes, left → right):
  //   outerL │ (inner−outer)L │ middle │ (inner−outer)R │ outerR
  const srcOuterLeftW = slice.outerLeft;
  const srcInnerLeftW = Math.max(0, slice.innerLeft - slice.outerLeft);
  const srcOuterRightW = slice.outerRight;
  const srcInnerRightW = Math.max(0, slice.innerRight - slice.outerRight);
  const srcMidW = Math.max(
    1,
    iw - srcOuterLeftW - srcInnerLeftW - srcOuterRightW - srcInnerRightW,
  );

  const srcOuterTopH = slice.outerTop;
  const srcInnerTopH = Math.max(0, slice.innerTop - slice.outerTop);
  const srcOuterBotH = slice.outerBottom;
  const srcInnerBotH = Math.max(0, slice.innerBottom - slice.outerBottom);
  const srcMidH = Math.max(
    1,
    ih - srcOuterTopH - srcInnerTopH - srcOuterBotH - srcInnerBotH,
  );

  // Build columns + rows. When the user sets maxStretchX/Y the
  // renderer inserts additional `(center + stripe)` rhythm tiles so
  // every stripe stays ≤ the cap — the corners no longer drift away
  // from a single lonely center ornament when the destination is much
  // wider than the source. Without a cap, we fall back to the
  // canonical 5-col / 5-row layout.
  const cols = buildBands({
    srcOuter: srcOuterLeftW,
    srcInnerStripeLeft: srcInnerLeftW,
    srcCenter: srcMidW,
    srcInnerStripeRight: srcInnerRightW,
    srcOuterEnd: srcOuterRightW,
    srcImageSize: iw,
    destSize: bounds.width,
    maxStretch: slice.maxStretchX ?? 0,
  });
  const rows = buildBands({
    srcOuter: srcOuterTopH,
    srcInnerStripeLeft: srcInnerTopH,
    srcCenter: srcMidH,
    srcInnerStripeRight: srcInnerBotH,
    srcOuterEnd: srcOuterBotH,
    srcImageSize: ih,
    destSize: bounds.height,
    maxStretch: slice.maxStretchY ?? 0,
  });

  // Static iff both row + col are non-stripe ("outer" or "center")
  // AND at least one of them is "outer". Generalizes the 5×5 rule to
  // any rhythm count: corners stay anchored, mid-edge ornaments stay
  // anchored, every "deep interior" cell stretches.
  function isFixedCell(r: number, c: number): boolean {
    const rk = rows[r].kind;
    const ck = cols[c].kind;
    if (rk === "stripe" || ck === "stripe") return false;
    return rk === "outer" || ck === "outer";
  }

  const out: Array<{
    sx: number; sy: number; sw: number; sh: number;
    dx: number; dy: number; dw: number; dh: number;
    key: string;
  }> = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      const row = rows[r];
      const col = cols[c];
      if (col.sw <= 0 || row.sh <= 0) continue;
      if (col.dw <= 0 || row.dh <= 0) continue;
      const dw = isFixedCell(r, c) ? col.sw : col.dw;
      const dh = isFixedCell(r, c) ? row.sh : row.dh;
      out.push({
        sx: col.sx,
        sy: row.sy,
        sw: col.sw,
        sh: row.sh,
        dx: col.dx,
        dy: row.dy,
        dw,
        dh,
        key: `${r}-${c}-${row.kind}-${col.kind}`,
      });
    }
  }

  return (
    <Group {...commonHandlers} x={bounds.x} y={bounds.y}>
      {out.map((s) => (
        <KImage
          key={s.key}
          image={image}
          x={s.dx}
          y={s.dy}
          width={s.dw}
          height={s.dh}
          crop={{ x: s.sx, y: s.sy, width: s.sw, height: s.sh }}
          listening={false}
        />
      ))}
    </Group>
  );
}

/**
 * Compute the band layout for one axis of a 25-slice. Produces a list
 * of `{ sx, sw, dx, dw, kind }` records where `kind` is one of:
 *
 *   • "outer"  — corner band, fixed at source size. There are always
 *                exactly two (start + end).
 *   • "stripe" — the band BETWEEN an outer/center pair. Stretches in
 *                destination; its destination width is bounded by
 *                `maxStretch` when that's > 0.
 *   • "center" — the static edge-ornament band. Always rendered at
 *                source width. There's exactly 1 by default; when
 *                `maxStretch` is set and the destination would force
 *                a stripe past the cap, additional centers + stripes
 *                are inserted symmetrically so the rhythm continues.
 *
 * Result is always laid out as: outer, stripe, center, stripe, center,
 * ..., stripe, outer — alternating stripe/center between the outers.
 * Length = 3 + 2*nCenters (5 in the canonical case).
 *
 * Source slice picking: all "stripe" cells sample from the source's
 * LEFT inner stripe band; "center" cells sample from the source's
 * middle band. Asymmetric source images (different left vs right
 * inner stripe widths) still work — the left source band is what
 * tiles across the destination.
 */
interface BuildBandsInput {
  /** Width/height of the outer band at the START of the axis. */
  srcOuter: number;
  /** Width/height of the inner stripe at the START of the axis. */
  srcInnerStripeLeft: number;
  /** Width/height of the static center band. */
  srcCenter: number;
  /** Width/height of the inner stripe at the END of the axis. */
  srcInnerStripeRight: number;
  /** Width/height of the outer band at the END of the axis. */
  srcOuterEnd: number;
  /** Source-image total along this axis (naturalWidth or Height). */
  srcImageSize: number;
  /** Destination total along this axis. */
  destSize: number;
  /** Max destination size of any single stripe. 0 = no cap. */
  maxStretch: number;
}

interface Band {
  /** Source-image start coord. */
  sx: number;
  /** Source-image span. */
  sw: number;
  /** Destination start coord. */
  dx: number;
  /** Destination span. */
  dw: number;
  kind: "outer" | "stripe" | "center";
}

function buildBands(input: BuildBandsInput): Band[] {
  const {
    srcOuter,
    srcInnerStripeLeft,
    srcCenter,
    srcInnerStripeRight,
    srcOuterEnd,
    srcImageSize,
    destSize,
    maxStretch,
  } = input;

  // Decide how many centers to place. The canonical layout has 1.
  // With a maxStretch cap, we may need more so every stripe stays
  // ≤ the cap.
  //   targetMid = destSize - srcOuter - srcOuterEnd
  //   nStripes  = nCenters + 1
  //   stripeW   = (targetMid - nCenters * srcCenter) / (nCenters + 1)
  // We want stripeW ≤ maxStretch:
  //   nCenters ≥ (targetMid - maxStretch) / (maxStretch + srcCenter)
  const targetMid = Math.max(0, destSize - srcOuter - srcOuterEnd);
  let nCenters = 1;
  if (maxStretch > 0 && srcCenter > 0) {
    const needed = Math.ceil(
      (targetMid - maxStretch) / Math.max(1, maxStretch + srcCenter),
    );
    nCenters = Math.max(1, needed);
    // Refuse to place more centers than the destination can fit at
    // source size — preserves the invariant that center width = src
    // and that stripes can't go negative.
    const maxFittable = Math.floor(targetMid / Math.max(1, srcCenter));
    if (nCenters > maxFittable) nCenters = Math.max(1, maxFittable);
  }

  const totalCenterW = nCenters * srcCenter;
  const totalStripeW = Math.max(0, targetMid - totalCenterW);
  const nStripes = nCenters + 1;
  const stripeW = nStripes > 0 ? totalStripeW / nStripes : 0;

  // Source picks: stripe cells crop from the LEFT inner stripe in the
  // source image (start = srcOuter). Center cells crop from the
  // middle band (start = srcOuter + srcInnerStripeLeft).
  //
  // Edge case: when both inner stripes are 0 in the source, there's
  // no stripe artwork to tile; the center band's left edge is the
  // outer band's right edge. Stripes in destination still render
  // (with width = stripeW) but they crop a 0-width source slice,
  // which we filter out at the call site.
  const stripeSrcX = srcOuter;
  const stripeSrcW = srcInnerStripeLeft > 0 ? srcInnerStripeLeft : srcInnerStripeRight;
  const centerSrcX = srcOuter + srcInnerStripeLeft;

  const bands: Band[] = [];
  let dxCursor = 0;

  // Leading outer.
  bands.push({
    sx: 0,
    sw: srcOuter,
    dx: dxCursor,
    dw: srcOuter,
    kind: "outer",
  });
  dxCursor += srcOuter;

  // Alternating stripe / center pairs. The LAST iteration drops the
  // center so we end on a stripe before the trailing outer.
  for (let i = 0; i < nCenters; i++) {
    bands.push({
      sx: stripeSrcX,
      sw: stripeSrcW,
      dx: dxCursor,
      dw: stripeW,
      kind: "stripe",
    });
    dxCursor += stripeW;
    bands.push({
      sx: centerSrcX,
      sw: srcCenter,
      dx: dxCursor,
      dw: srcCenter,
      kind: "center",
    });
    dxCursor += srcCenter;
  }

  // Trailing stripe (uses the RIGHT inner stripe source band so an
  // asymmetric source still ends on its own art).
  const rightStripeSrcX = srcImageSize - srcOuterEnd - srcInnerStripeRight;
  bands.push({
    sx: rightStripeSrcX,
    sw: srcInnerStripeRight > 0 ? srcInnerStripeRight : srcInnerStripeLeft,
    dx: dxCursor,
    dw: stripeW,
    kind: "stripe",
  });
  dxCursor += stripeW;

  // Trailing outer.
  bands.push({
    sx: srcImageSize - srcOuterEnd,
    sw: srcOuterEnd,
    dx: dxCursor,
    dw: srcOuterEnd,
    kind: "outer",
  });

  return bands;
}

/* ---------------------------------------------------------------------- */
/* Zoom readout (overlay UI, lives outside the Konva stage)               */
/* ---------------------------------------------------------------------- */

function ZoomReadout() {
  const viewport = useDesigner((s) => s.viewport);
  const overlays = useDesigner((s) => s.overlays);
  const toggleOverlay = useDesigner((s) => s.toggleOverlay);
  const resetViewport = useDesigner((s) => s.resetViewport);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-ink-700 bg-ink-900/90 px-2 py-1 text-[11px] text-ink-300 shadow-panel backdrop-blur">
      <PillButton onClick={resetViewport}>Reset view</PillButton>
      <span className="px-1 text-ink-400">{(viewport.scale * 100).toFixed(0)}%</span>
      <span className="mx-1 h-3 w-px bg-ink-700" />
      <PillToggle on={overlays.grid} onClick={() => toggleOverlay("grid")}>
        Grid
      </PillToggle>
      <PillToggle on={overlays.safeZone} onClick={() => toggleOverlay("safeZone")}>
        Safe
      </PillToggle>
      <PillToggle on={overlays.bleed} onClick={() => toggleOverlay("bleed")}>
        Bleed
      </PillToggle>
    </div>
  );
}

function PillButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-2 py-0.5 text-ink-300 hover:bg-ink-700 hover:text-ink-50"
    >
      {children}
    </button>
  );
}

function PillToggle({
  children,
  onClick,
  on,
}: {
  children: React.ReactNode;
  onClick: () => void;
  on: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-2 py-0.5",
        on
          ? "bg-accent-500/15 text-accent-300"
          : "text-ink-400 hover:bg-ink-700 hover:text-ink-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
