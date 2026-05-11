/**
 * Card Type Designer — domain types.
 *
 * The designer's job is to produce a `CardTypeTemplate` JSON document. A template
 * describes the *layout* of a card type (frame, name plate, art window, rules
 * box, ability panels, level bar, etc.) and the *zones* — named, data-bound areas
 * where future card data will land.
 *
 * The shape here is intentionally a subset of spec section 19 (Card Type Designer),
 * sec 21 (Variant System), and sec 22 (Schema System). We will grow this file as
 * the designer earns more responsibilities. Keep it back-compatible — every layer
 * must continue to round-trip through JSON.
 */

export type LayerId = string;

/** Pixel-space rectangle aligned with the canvas (0,0 is top-left of the card). */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What kind of node this layer is. Drives both rendering and the inspector. */
export type LayerType = "rect" | "text" | "image" | "zone" | "group";

// ---------------------------------------------------------------------------
// Variant rules (sec 21)
// ---------------------------------------------------------------------------

/**
 * Operators a single condition can use.
 *
 * Spec sec 21.4 lists more (regex / contains / lt / gte / …). We start with
 * the ones a TCG designer reaches for first; the evaluator in `lib/variants.ts`
 * is open for extension and the inspector picks operators from this enum.
 */
export type VariantOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "exists"
  | "missing";

export interface VariantCondition {
  /** Key into `previewData` (and, eventually, the live card record). */
  field: string;
  op: VariantOperator;
  /** Right-hand-side value. For `in` / `not_in` this is a string array. */
  value?: unknown;
}

/**
 * `appliesWhen` rule on a layer.
 *
 * `match: "all"` means every condition must hold; `"any"` means at least one.
 * Empty conditions list ⇒ the rule is vacuous and the layer always applies
 * (consistent with classical "all of {} ⇒ true" / "any of {} ⇒ false" being
 * confusing in UX, we treat both empty cases as "always visible").
 */
export interface AppliesWhenRule {
  match: "all" | "any";
  conditions: VariantCondition[];
}

/**
 * A variant override on a layer. When the rule matches the active card data,
 * the renderer merges `overrides` over the base layer's properties before
 * drawing — so a single layer can present different frame art / fills /
 * text per faction, rarity, etc.
 *
 * First-match-wins (in array order). Authors can intentionally order
 * specific rules above generic ones.
 *
 * `overrides` is intentionally loosely typed: it can carry any partial
 * patch (`assetId`, `src`, `fill`, `stroke`, `text`, `fontSize`, …). The
 * renderer cherry-picks the keys it knows about.
 */
export interface LayerVariant {
  /** Optional label shown in the inspector (e.g. "Fire frame"). */
  name?: string;
  match: "all" | "any";
  conditions: VariantCondition[];
  overrides: Record<string, unknown>;
}

/** Common fields shared by every layer regardless of type. */
interface BaseLayer {
  id: LayerId;
  /** User-visible name — shown in the layer tree. */
  name: string;
  type: LayerType;
  bounds: Bounds;
  /** Rotation in degrees, around the layer's top-left. */
  rotation: number;
  /** Hidden layers are skipped during render and export. */
  visible: boolean;
  /** Locked layers cannot be moved or resized. */
  locked: boolean;
  /**
   * Opacity in 0..1. Defaults to 1.
   * Stored on the layer rather than per-type so the inspector can be uniform.
   */
  opacity: number;
  /**
   * Optional variant rule. When undefined / null, the layer is always applied
   * (modulo `visible`). When set, the layer renders only if the rule matches
   * the current preview / card data.
   */
  appliesWhen?: AppliesWhenRule | null;
  /**
   * Optional per-layer variant overrides. The renderer walks this list in
   * order; the first variant whose rule matches contributes its `overrides`
   * patch to the rendered layer. Undefined means "always render the base".
   */
  variants?: LayerVariant[];
  /**
   * Optional parent group's id. When set, this layer is nested under a
   * `GroupLayer` in the layer tree. The flat array is the source of truth
   * for render order; `parentId` is purely structural — the LayerTree
   * builds the hierarchy by walking the array and indexing by parent.
   *
   * `null` / undefined means "top level".
   */
  parentId?: string | null;
}

/** A solid (or stroked) rectangle. Useful for frames, plates, dividers. */
export interface RectLayer extends BaseLayer {
  type: "rect";
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  /** Border radius in px, applied uniformly to all corners. */
  cornerRadius: number;
}

/** Static text. For data-bound text use a `zone` with binding "text". */
export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fill: string;
  fontFamily: string;
  fontSize: number;
  fontStyle: "normal" | "italic" | "bold" | "bold italic";
  align: "left" | "center" | "right";
  /** Vertical alignment inside the bounds. */
  verticalAlign: "top" | "middle" | "bottom";
  /** When true, text wraps within `bounds.width`; otherwise it overflows. */
  wrap: boolean;
  /**
   * Optional SVG path-data string. When set, the renderer flows the
   * text along the path instead of drawing it horizontally. Path data
   * is resolved in the layer's local coordinate space — i.e. relative
   * to `bounds.x`/`bounds.y`.
   *
   * Example: `M 0 50 Q 150 0 300 50` draws an upward arc from
   * (0,50) to (300,50) with a control point at (150,0).
   *
   * For SVG output we use native `<textPath>`; for Konva we manually
   * position glyphs along the path with `Konva.TextPath`.
   */
  pathData?: string | null;
  /**
   * Where the text sits relative to the path. "side" matches SVG's
   * `side` attribute on `<textPath>`. "left" is the convention for
   * upper-arc text (text rides on top of the curve); "right" flips it
   * underneath. Defaults to "left".
   */
  pathSide?: "left" | "right";
  /**
   * Optional starting offset along the path, expressed as a percentage
   * (0–100) of path length. Useful for centering ("50%") or aligning
   * text without manually trimming whitespace from `text`.
   */
  pathStartOffset?: number;
}

/**
 * 9-slice insets (in source-image pixels) measured from each edge inward.
 *
 * When set, the renderer cuts the source image into 9 regions:
 *   - 4 corners (top/right/bottom/left of the image) which never stretch
 *   - 4 edges that stretch in one dimension only
 *   - 1 center that stretches in both dimensions
 *
 * This is the standard technique for card frames / nameplates / panels:
 *   the corner artwork stays crisp at any rendered size.
 */
export interface NineSlice {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * 25-slice insets — extends 9-slice with a second cut per side so the
 * renderer produces a 5×5 grid (25 regions) instead of 3×3 (9).
 *
 * Layout, left → right (same shape vertically). Source-image widths:
 *   outerL │ (innerL − outerL) │ midW │ (innerR − outerR) │ outerR
 *   col 0  │      col 1        │ col 2│       col 3       │ col 4
 *
 * Cell stretchiness, with (row, col) indexed 0..4:
 *
 *   • STATIC (drawn at source dimensions — never stretch or repeat):
 *       (0,0) (0,2) (0,4)   — top row: corners + top-center ornament
 *       (2,0)       (2,4)   — middle row: left/right edge centers
 *       (4,0) (4,2) (4,4)   — bottom row: corners + bottom-center ornament
 *     8 static cells total.
 *
 *   • STRETCH:
 *       Everything else. The "inner stripe" columns/rows (1, 3) take
 *       all the destination slack, split proportionally between left/
 *       right and top/bottom stripes. The center column / row stays
 *       at source size in the destination — that's what keeps the
 *       mid-edge ornament cells from drifting away from the actual
 *       edge as the frame scales.
 *
 *     Per-axis stretchiness within those non-static cells:
 *       - row 0/4 × col 1/3  → stretch X only (outer edge stripes)
 *       - row 1/3 × col 0/4  → stretch Y only (outer edge stripes)
 *       - row 1/3 × col 2    → stretch X only (inner top/bottom rail)
 *       - row 2   × col 1/3  → stretch X only? No — these expand into
 *                              the inner-stripe slack on the X axis,
 *                              and row 2 is fixed-height, so they
 *                              stretch X. Same logic.
 *       - row 1/3 × col 1/3  → stretch both axes
 *       - row 2   × col 2    → stretch both axes (the dead center,
 *                              typically transparent — this is what
 *                              makes 25-slice useful for card frames:
 *                              decorative corners + edge ornaments
 *                              stay sharp while the interior scales).
 *
 * Constraints:
 *   • Each `inner*` ≥ matching `outer*` (otherwise the inner stripe
 *     would have negative width).
 *   • innerLeft + innerRight < image width, and same for top+bottom,
 *     so the middle band has at least 1px.
 */
export interface TwentyFiveSlice {
  /** Outer offsets — same role as NineSlice fields. */
  outerTop: number;
  outerRight: number;
  outerBottom: number;
  outerLeft: number;
  /** Inner offsets — must be ≥ the matching outer value. */
  innerTop: number;
  innerRight: number;
  innerBottom: number;
  innerLeft: number;
  /**
   * Maximum destination width of any single inner stripe on the X
   * axis. 0 or undefined = unlimited (default — one static center
   * per edge, the canonical 5×5 layout). When set, the renderer
   * inserts additional `(center + stripe)` rhythm tiles along the
   * top + bottom edges so every stripe stays ≤ this value. Useful
   * when a decorative frame is scaled far beyond its source width
   * and the user doesn't want the corners to drift away from a
   * single lonely center ornament — instead, the ornament repeats
   * at a steady rhythm.
   */
  maxStretchX?: number;
  /** Same as `maxStretchX`, on the vertical axis. */
  maxStretchY?: number;
}

/** Source-image-space rectangle used to crop the source before fitting. */
export interface ImageCrop {
  /** X position in source pixels (top-left of the crop window). */
  x: number;
  /** Y position in source pixels. */
  y: number;
  /** Width of the crop window in source pixels. */
  width: number;
  /** Height of the crop window in source pixels. */
  height: number;
}

/**
 * How the image fills the layer bounds. `repeat` tiles the (cropped) image
 * at `tileScale` size; the others scale a single instance.
 *
 * - "contain" — fit entire image inside bounds, letterboxing if needed.
 * - "cover"   — fill the bounds, cropping overflow on the long axis.
 * - "fill"    — stretch independently on each axis (aspect ignored).
 * - "repeat"  — tile the image at natural (or scaled) size to cover bounds.
 */
export type ImageFit = "contain" | "cover" | "fill" | "repeat";

/** Tile scaling for repeat-fit images. 1 = natural cropped size. */
export interface TileScale {
  x: number;
  y: number;
}

/** Placeholder for a raster image. Real asset lookup comes with the asset library. */
export interface ImageLayer extends BaseLayer {
  type: "image";
  /** Asset reference (assetId in the future asset library). null = empty placeholder. */
  assetId: string | null;
  /** Optional URL override for prototype-time image previews. */
  src: string | null;
  /** How to fit the image inside `bounds`. Ignored when `slice` is set. */
  fit: ImageFit;
  /**
   * Optional 9-slice insets in source-image pixels. When present and the
   * loaded image is large enough to honour them, the renderer composes nine
   * cropped regions instead of a single stretched image. When absent the
   * image renders normally per `fit`.
   */
  slice?: NineSlice | null;
  /**
   * Optional 25-slice config. Mutually exclusive with `slice` — when
   * both are set, `slice25` wins (the renderer never combines them).
   * See `TwentyFiveSlice` for the cell layout.
   */
  slice25?: TwentyFiveSlice | null;
  /**
   * Optional source crop rectangle. When set, the renderer first crops the
   * source image to this rectangle (in source pixels), then applies `fit`
   * and `slice` to the cropped pixels. This is how spritesheet cells are
   * displayed without splitting the source — and how artists can punch in
   * on a region without re-uploading.
   */
  crop?: ImageCrop | null;
  /**
   * Pan offset in destination pixels — applied AFTER fit. Useful for
   * nudging "cover"-fitted art so the focal point lands where the user
   * wants. For repeat-fit images this also shifts the tile origin (so
   * seams move with the offset).
   */
  offset?: { x: number; y: number };
  /**
   * Tile size multiplier when `fit === "repeat"`. (1, 1) tiles at the
   * cropped image's natural size; (0.5, 0.5) makes each tile half size,
   * (2, 2) doubles them. Ignored for other fit modes.
   */
  tileScale?: TileScale | null;
  /**
   * Optional schema field key. When set, the renderer pulls the image
   * source from `card.dataJson[fieldKey]` (asset id, asset blob URL, or any
   * external URL) before falling back to `assetId` / `src`. This is how
   * "Card art" varies per card while the rest of the layout stays shared.
   */
  fieldKey?: string;
}

/**
 * A "zone" is a named, data-bound area. It does *not* contain real card data —
 * that lives on `Card` records elsewhere. The zone declares "this is where the
 * card name goes" and the renderer / exporter resolves it later.
 */
export type ZoneBinding =
  | "text"
  | "richText"
  | "number"
  | "image"
  | "icon"
  | "stat";

export interface ZoneLayer extends BaseLayer {
  type: "zone";
  /** Schema field name this zone binds to (e.g. "name", "rules_text", "cost"). */
  fieldKey: string;
  binding: ZoneBinding;
  /** Optional placeholder shown in the designer when no card data is loaded. */
  placeholder: string;
  /** Background tint shown only inside the designer; not rendered at export. */
  designerTint: string;
  /** Shared text-style hints (used when binding is text/richText/number/stat). */
  fontFamily: string;
  fontSize: number;
  align: "left" | "center" | "right";
  fill: string;
}

/**
 * A purely organizational node in the layer tree. Groups don't draw —
 * they exist to let designers collapse / hide / variant-gate a set of
 * sibling layers as a unit. Children carry `parentId` set to this group's
 * id; render order remains driven by the layer array's order.
 *
 * When a group's `visible` is false, all descendants are skipped at
 * render time. When a group has `appliesWhen`, the rule cascades — a
 * descendant only renders if every ancestor group's rule also matches.
 *
 * `bounds` exists for layout consistency (the group's nominal
 * bounding box, useful for the inspector / future "transform group as
 * a unit" feature) but is otherwise unused by the renderer.
 */
export interface GroupLayer extends BaseLayer {
  type: "group";
  /** Persisted UI state — folded vs unfolded in the layer tree. */
  collapsed?: boolean;
}

export type Layer = RectLayer | TextLayer | ImageLayer | ZoneLayer | GroupLayer;

/** Top-level template. Mirrors a future `templates` row in Postgres. */
export interface CardTypeTemplate {
  /** Schema version. Bump when the on-disk JSON shape changes. */
  version: 1;
  id: string;
  name: string;
  /** Human-readable description (e.g. "Standard character card frame, v1"). */
  description: string;
  /** Card design size in pixels at print DPI (default 750x1050 = 2.5"x3.5" @ 300dpi). */
  size: { width: number; height: number };
  /** Bleed in pixels on each edge — total card with bleed is size + 2*bleed. */
  bleed: number;
  /** Safe zone in pixels in from each edge — content beyond risks being cut. */
  safeZone: number;
  /** Effective resolution this template was authored at. Drives the
   *  inch/mm dimension readout and the "low DPI for print" validation
   *  warning. Optional with a default of 300 so older templates keep
   *  working without a migration. */
  dpi?: number;
  /** Background fill rendered behind every layer. */
  background: string;
  /** Layers in render order — index 0 is bottom-most. */
  layers: Layer[];
  /**
   * Mock card data used by the designer to evaluate variant rules. Has no
   * effect at render time once a real Card is bound — it's a design-time
   * preview only.
   */
  previewData?: Record<string, unknown>;
}
