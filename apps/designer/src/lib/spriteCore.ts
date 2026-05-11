/**
 * Sprite-sheet frame detection — ported from the open-source
 * spriteSplitter-master tool (Belahcen Marwane + Michael Brown
 * fork) at E:\tools\spriteSplitter-master. Kept as a dependency-free
 * pure-data module so it can run inside a worker later, and so the
 * algorithm is testable independent of the React UI.
 *
 * Capabilities over the plain connected-component pass in
 * `objectDetect.ts`:
 *   • Configurable reference pixel (eyedropper) instead of just
 *     "four corner average".
 *   • Separate RGB-tolerance and alpha-tolerance.
 *   • 4- or 8-connectivity (diagonals).
 *   • Minimum width / height / pixel-count filters.
 *   • Padding around each detected frame.
 *   • Merge-nearby-frames (closes the gap between split detections
 *     within `mergeDistance` px).
 *   • Background-removal mode: "connected" (flood from edges + ref
 *     pixel) keeps interior bg-color holes, "global" eliminates every
 *     matching pixel anywhere.
 *   • Feather foreground edges after BG removal (radius 1..12).
 *   • Frame issue diagnostics (large-frame / tiny-artifact /
 *     sparse-frame) with copy suggesting how to fix.
 */

export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelCount: number;
}

export interface SpriteDetectOptions {
  /** Pixel coordinate to sample the background color from. (0,0) is
   *  the top-left. Defaults to (0,0) when omitted. */
  referencePoint?: { x: number; y: number };
  /** RGB-channel tolerance (0..255). Pixel is "background" if each
   *  channel is within `tolerance` of the reference pixel. */
  tolerance?: number;
  /** Alpha-channel tolerance (0..255). When the reference alpha is
   *  ≤ alphaTolerance AND the pixel alpha is ≤ alphaTolerance, the
   *  pixel is considered background regardless of color (handles
   *  transparent backdrops). */
  alphaTolerance?: number;
  /** Drop frames whose width is below this. */
  minWidth?: number;
  /** Drop frames whose height is below this. */
  minHeight?: number;
  /** Drop frames whose foreground pixel count is below this. */
  minPixels?: number;
  /** 4 or 8. Diagonals are included when 8. Default 4 (separates
   *  sprites that touch only at a corner). */
  connectivity?: 4 | 8;
  /** Merge nearby frames within this many px gap. 0 = no merging. */
  mergeDistance?: number;
  /** Expand each detected bbox by this many px after merging. */
  padding?: number;
  /** Background removal mode: "connected" flood-fills from image
   *  edges + the reference pixel; "global" zeros every matching
   *  pixel anywhere on the sheet. */
  backgroundRemoval?: "connected" | "global";
  /** When true, alpha-blend the foreground edges so they fade to
   *  transparent instead of cutting sharply. */
  featherEdges?: boolean;
  /** Box radius for feathering (1..12). */
  featherRadius?: number;
}

export type NormalizedSpriteOptions = Required<SpriteDetectOptions>;

const FOUR_WAY_NEIGHBOURS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const EIGHT_WAY_NEIGHBOURS: ReadonlyArray<{ x: number; y: number }> = [
  ...FOUR_WAY_NEIGHBOURS,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function getDefaultSpriteOptions(): NormalizedSpriteOptions {
  return {
    referencePoint: { x: 0, y: 0 },
    tolerance: 0,
    alphaTolerance: 0,
    minWidth: 1,
    minHeight: 1,
    minPixels: 1,
    connectivity: 4,
    mergeDistance: 0,
    padding: 0,
    backgroundRemoval: "connected",
    featherEdges: false,
    featherRadius: 1,
  };
}

export function normalizeSpriteOptions(
  options: SpriteDetectOptions | undefined,
  width: number,
  height: number,
): NormalizedSpriteOptions {
  const defaults = getDefaultSpriteOptions();
  const o = options ?? {};
  const safeW = Math.max(width || 1, 1);
  const safeH = Math.max(height || 1, 1);
  const maxDim = Math.max(safeW, safeH);
  const tolerance = clampInt(o.tolerance, 0, 255, defaults.tolerance);
  const alphaTolerance = clampInt(
    o.alphaTolerance ?? tolerance,
    0,
    255,
    tolerance,
  );
  const connectivity: 4 | 8 =
    clampInt(o.connectivity, 4, 8, defaults.connectivity) === 8 ? 8 : 4;
  const backgroundRemoval =
    o.backgroundRemoval === "global" ? "global" : defaults.backgroundRemoval;
  return {
    referencePoint: {
      x: clampInt(o.referencePoint?.x, 0, Math.max(safeW - 1, 0), 0),
      y: clampInt(o.referencePoint?.y, 0, Math.max(safeH - 1, 0), 0),
    },
    tolerance,
    alphaTolerance,
    minWidth: clampInt(o.minWidth, 1, safeW, defaults.minWidth),
    minHeight: clampInt(o.minHeight, 1, safeH, defaults.minHeight),
    minPixels: clampInt(o.minPixels, 1, safeW * safeH, defaults.minPixels),
    connectivity,
    mergeDistance: clampInt(o.mergeDistance, 0, maxDim, defaults.mergeDistance),
    padding: clampInt(o.padding, 0, maxDim, defaults.padding),
    backgroundRemoval,
    featherEdges: o.featherEdges === true,
    featherRadius: clampInt(
      o.featherRadius,
      1,
      Math.min(maxDim, 12),
      defaults.featherRadius,
    ),
  };
}

interface Pixel {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function getPixel(img: ImageData, x: number, y: number): Pixel {
  const i = (img.width * y + x) * 4;
  const d = img.data;
  return { red: d[i], green: d[i + 1], blue: d[i + 2], alpha: d[i + 3] };
}

function isBackgroundPixel(
  pixel: Pixel,
  ref: Pixel,
  opts: NormalizedSpriteOptions,
): boolean {
  // Both transparent enough → background regardless of RGB.
  if (ref.alpha <= opts.alphaTolerance && pixel.alpha <= opts.alphaTolerance) {
    return true;
  }
  if (Math.abs(pixel.alpha - ref.alpha) > opts.alphaTolerance) return false;
  return (
    Math.abs(pixel.red - ref.red) <= opts.tolerance &&
    Math.abs(pixel.green - ref.green) <= opts.tolerance &&
    Math.abs(pixel.blue - ref.blue) <= opts.tolerance
  );
}

function buildGlobalBackgroundMask(
  img: ImageData,
  ref: Pixel,
  opts: NormalizedSpriteOptions,
): Uint8Array {
  const w = img.width;
  const h = img.height;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBackgroundPixel(getPixel(img, x, y), ref, opts)) {
        mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}

function buildConnectedBackgroundMask(
  img: ImageData,
  ref: Pixel,
  opts: NormalizedSpriteOptions,
): Uint8Array {
  const w = img.width;
  const h = img.height;
  const mask = new Uint8Array(w * h);
  const queue: Array<{ x: number; y: number }> = [];
  let head = 0;
  const neighbours = EIGHT_WAY_NEIGHBOURS;

  function addSeed(x: number, y: number) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (mask[idx]) return;
    if (!isBackgroundPixel(getPixel(img, x, y), ref, opts)) return;
    mask[idx] = 1;
    queue.push({ x, y });
  }

  for (let x = 0; x < w; x++) {
    addSeed(x, 0);
    addSeed(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    addSeed(0, y);
    addSeed(w - 1, y);
  }
  addSeed(opts.referencePoint.x, opts.referencePoint.y);

  while (head < queue.length) {
    const current = queue[head++];
    for (const n of neighbours) {
      addSeed(current.x + n.x, current.y + n.y);
    }
  }
  return mask;
}

export function buildBackgroundMask(
  img: ImageData,
  opts: SpriteDetectOptions,
): Uint8Array {
  const o = normalizeSpriteOptions(opts, img.width, img.height);
  const ref = getPixel(img, o.referencePoint.x, o.referencePoint.y);
  return o.backgroundRemoval === "global"
    ? buildGlobalBackgroundMask(img, ref, o)
    : buildConnectedBackgroundMask(img, ref, o);
}

/**
 * Zero out background pixels and optionally feather the foreground
 * edge. Returns a fresh ImageData; the input is not mutated.
 */
export function removeBackground(
  img: ImageData,
  opts: SpriteDetectOptions,
): {
  imageData: ImageData;
  removedPixelCount: number;
  featheredPixelCount: number;
} {
  if (!img || !img.data || !img.width || !img.height) {
    return { imageData: img, removedPixelCount: 0, featheredPixelCount: 0 };
  }
  const o = normalizeSpriteOptions(opts, img.width, img.height);
  const ref = getPixel(img, o.referencePoint.x, o.referencePoint.y);
  const mask =
    o.backgroundRemoval === "global"
      ? buildGlobalBackgroundMask(img, ref, o)
      : buildConnectedBackgroundMask(img, ref, o);
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

  let removed = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const off = i * 4;
    if (out.data[off + 3] !== 0) removed += 1;
    out.data[off + 3] = 0;
  }

  const feathered = featherForegroundEdges(out, mask, o);
  return { imageData: out, removedPixelCount: removed, featheredPixelCount: feathered };
}

function featherForegroundEdges(
  output: ImageData,
  bgMask: Uint8Array,
  opts: NormalizedSpriteOptions,
): number {
  if (!opts.featherEdges) return 0;
  const w = output.width;
  const h = output.height;
  const r = opts.featherRadius;
  let n = 0;

  function nearestBgChebyshev(cx: number, cy: number): number {
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(w - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(h - 1, cy + r);
    let best = r + 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!bgMask[y * w + x]) continue;
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        if (d < best) best = d;
        if (best <= 1) return best;
      }
    }
    return best <= r ? best : 0;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (bgMask[idx]) continue;
      const distance = nearestBgChebyshev(x, y);
      if (!distance) continue;
      const off = idx * 4;
      const alpha = output.data[off + 3];
      const feathered = Math.max(1, Math.round((alpha * distance) / (r + 1)));
      if (feathered < alpha) {
        output.data[off + 3] = feathered;
        n += 1;
      }
    }
  }
  return n;
}

function sortFrames(frames: SpriteFrame[]): SpriteFrame[] {
  return frames.slice().sort((l, r) => {
    if (l.y !== r.y) return l.y - r.y;
    if (l.x !== r.x) return l.x - r.x;
    if (l.height !== r.height) return r.height - l.height;
    return r.width - l.width;
  });
}

function getFrameGap(l: SpriteFrame, r: SpriteFrame): { x: number; y: number } {
  const lr = l.x + l.width;
  const rr = r.x + r.width;
  const lb = l.y + l.height;
  const rb = r.y + r.height;
  return {
    x: lr < r.x ? r.x - lr : rr < l.x ? l.x - rr : 0,
    y: lb < r.y ? r.y - lb : rb < l.y ? l.y - rb : 0,
  };
}

function mergeFrameBounds(l: SpriteFrame, r: SpriteFrame): SpriteFrame {
  const minX = Math.min(l.x, r.x);
  const minY = Math.min(l.y, r.y);
  const maxX = Math.max(l.x + l.width, r.x + r.width);
  const maxY = Math.max(l.y + l.height, r.y + r.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    pixelCount: l.pixelCount + r.pixelCount,
  };
}

export function mergeNearbyFrames(
  frames: SpriteFrame[],
  mergeDistance: number,
): SpriteFrame[] {
  if (mergeDistance <= 0) return frames.slice();
  const merged = frames.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const gap = getFrameGap(merged[i], merged[j]);
        if (gap.x <= mergeDistance && gap.y <= mergeDistance) {
          merged[i] = mergeFrameBounds(merged[i], merged[j]);
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}

/**
 * Merge a hand-picked set of frames into one bbox. Used by the
 * "Merge selected" action in the UI when detection split a single
 * sprite across multiple boxes.
 */
export function mergeFrameList(frames: SpriteFrame[]): SpriteFrame | undefined {
  if (frames.length === 0) return undefined;
  let m = { ...frames[0] };
  for (let i = 1; i < frames.length; i++) m = mergeFrameBounds(m, frames[i]);
  return m;
}

function applyFramePadding(
  f: SpriteFrame,
  padding: number,
  width: number,
  height: number,
): SpriteFrame {
  const minX = Math.max(0, f.x - padding);
  const minY = Math.max(0, f.y - padding);
  const maxX = Math.min(width, f.x + f.width + padding);
  const maxY = Math.min(height, f.y + f.height + padding);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    pixelCount: f.pixelCount,
  };
}

/**
 * Detect frames on a sprite sheet. Single-pass BFS-flood for each
 * unvisited foreground pixel; emits one bbox per component. Filters
 * by minWidth/Height/Pixels, then merges nearby frames within
 * mergeDistance, then pads.
 */
export function detectFrames(
  img: ImageData,
  options: SpriteDetectOptions = {},
): SpriteFrame[] {
  if (!img || !img.data || !img.width || !img.height) return [];
  const o = normalizeSpriteOptions(options, img.width, img.height);
  const w = img.width;
  const h = img.height;
  const ref = getPixel(img, o.referencePoint.x, o.referencePoint.y);
  const bgMask =
    o.backgroundRemoval === "global"
      ? buildGlobalBackgroundMask(img, ref, o)
      : buildConnectedBackgroundMask(img, ref, o);

  const visited = new Uint8Array(w * h);
  const neighbours =
    o.connectivity === 8 ? EIGHT_WAY_NEIGHBOURS : FOUR_WAY_NEIGHBOURS;
  const queue: Array<{ x: number; y: number }> = [];
  const frames: SpriteFrame[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx]) continue;
      if (bgMask[idx]) {
        visited[idx] = 1;
        continue;
      }
      let head = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixelCount = 0;
      queue.length = 0;
      queue.push({ x, y });
      visited[idx] = 1;

      while (head < queue.length) {
        const cur = queue[head++];
        pixelCount += 1;
        if (cur.x < minX) minX = cur.x;
        if (cur.x > maxX) maxX = cur.x;
        if (cur.y < minY) minY = cur.y;
        if (cur.y > maxY) maxY = cur.y;
        for (const n of neighbours) {
          const nx = cur.x + n.x;
          const ny = cur.y + n.y;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni]) continue;
          visited[ni] = 1;
          if (!bgMask[ni]) queue.push({ x: nx, y: ny });
        }
      }
      frames.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        pixelCount,
      });
    }
  }

  return sortFrames(
    mergeNearbyFrames(frames, o.mergeDistance)
      .filter((f) => f.width >= o.minWidth && f.height >= o.minHeight && f.pixelCount >= o.minPixels)
      .map((f) => applyFramePadding(f, o.padding, w, h)),
  );
}

/**
 * Pick the topmost frame containing (x, y) — used for click-to-select
 * in the UI overlay.
 */
export function findFrameAtPoint(
  frames: SpriteFrame[],
  point: { x: number; y: number },
): SpriteFrame | undefined {
  return frames.find(
    (f) =>
      point.x >= f.x &&
      point.y >= f.y &&
      point.x < f.x + f.width &&
      point.y < f.y + f.height,
  );
}

/* --------------------------------------------------------------------- */
/* Diagnostics                                                            */
/* --------------------------------------------------------------------- */

export interface FrameIssueReport {
  /** Map from `getFrameSignature(frame)` → list of issue kinds. */
  bySignature: Record<string, FrameIssueKind[]>;
  counts: {
    noneDetected: number;
    largeFrame: number;
    tinyArtifact: number;
    sparseFrame: number;
    total: number;
  };
  /** Human-readable warning strings for the UI. */
  warnings: string[];
}

export type FrameIssueKind = "large-frame" | "tiny-artifact" | "sparse-frame";

export function getFrameSignature(f: SpriteFrame): string {
  return `${f.x}:${f.y}:${f.width}:${f.height}`;
}

/**
 * Detect common detection problems and surface fix suggestions:
 *   • large-frame  — one frame covers most of the sheet; usually
 *     means background removal didn't strip the backdrop. Suggest
 *     switching to global removal or picking a different reference
 *     pixel.
 *   • tiny-artifact — frame is so small it's probably noise. Suggest
 *     raising the min-pixel threshold or merge distance.
 *   • sparse-frame  — bbox is big but contains few foreground pixels.
 *     Same suggestion as tiny-artifact.
 */
export function findFrameIssues(
  frames: SpriteFrame[],
  imageSize: { width: number; height: number },
  options?: {
    largeFrameCoverage?: number;
    tinyDimension?: number;
    tinyPixels?: number;
    sparseRatio?: number;
  },
): FrameIssueReport {
  const opts = options ?? {};
  const imageArea = Math.max(0, imageSize.width) * Math.max(0, imageSize.height);
  const largeFrameCoverage = opts.largeFrameCoverage ?? 0.85;
  const tinyDimension = opts.tinyDimension ?? 2;
  const tinyPixels = opts.tinyPixels ?? 4;
  const sparseRatio = opts.sparseRatio ?? 0.1;
  const result: FrameIssueReport = {
    bySignature: {},
    counts: { noneDetected: 0, largeFrame: 0, tinyArtifact: 0, sparseFrame: 0, total: 0 },
    warnings: [],
  };

  function add(frame: SpriteFrame, issue: FrameIssueKind) {
    const sig = getFrameSignature(frame);
    if (!result.bySignature[sig]) result.bySignature[sig] = [];
    if (!result.bySignature[sig].includes(issue)) {
      result.bySignature[sig].push(issue);
      result.counts.total += 1;
    }
  }

  if (frames.length === 0 && imageArea > 0) {
    result.counts.noneDetected = 1;
    result.counts.total = 1;
    result.warnings.push(
      "No frames were detected. Try another reference pixel, higher tolerance, or lower minimum size.",
    );
    return result;
  }

  for (const f of frames) {
    const area = Math.max(0, f.width) * Math.max(0, f.height);
    const coverage = imageArea > 0 ? area / imageArea : 0;
    const fgRatio = area > 0 ? f.pixelCount / area : 0;
    if (coverage >= largeFrameCoverage && fgRatio > sparseRatio) {
      add(f, "large-frame");
      result.counts.largeFrame += 1;
    }
    if (f.width <= tinyDimension || f.height <= tinyDimension || f.pixelCount <= tinyPixels) {
      add(f, "tiny-artifact");
      result.counts.tinyArtifact += 1;
    } else if (fgRatio <= sparseRatio) {
      add(f, "sparse-frame");
      result.counts.sparseFrame += 1;
    }
  }

  if (result.counts.largeFrame) {
    result.warnings.push(
      "One or more frames cover most of the sheet. Try global background removal or a different reference pixel.",
    );
  }
  if (result.counts.tinyArtifact || result.counts.sparseFrame) {
    result.warnings.push(
      "Some frames look like tiny artifacts. Try increasing minimum pixels or merge distance.",
    );
  }
  return result;
}
