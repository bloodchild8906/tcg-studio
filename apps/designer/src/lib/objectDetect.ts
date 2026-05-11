/**
 * Shared connected-component labelling for image-pixel data.
 *
 * Two surfaces:
 *   • `detectObjects` — walk every pixel, return one bbox per
 *     foreground component (used by the sprite splitter's
 *     "Detect objects" mode).
 *   • `selectObjectAt` — flood from a single seed point, return
 *     just that one component's bbox (used by the ImageEditor's
 *     object-select tool).
 *
 * Both use a 4-connected BFS over the alpha (or chroma-distance)
 * threshold rule. Diagonal connectivity tends to merge sprites that
 * touch at a corner — we want them separate in nearly every case.
 *
 * Kept dep-free so it can run inside a worker later without React
 * coming along for the ride.
 */

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectOpts {
  /**
   * Background sampler:
   *   • "transparent" — pixels with alpha ≤ `bgThreshold` are background.
   *     Right answer for PNG cutouts.
   *   • "corner"      — average a 3×3 patch at each of the four corners,
   *     pixels within `bgThreshold` RGB-distance of that average are
   *     background. Works for solid-color backdrops.
   */
  bgMode: "corner" | "transparent";
  /** 0..255. See `bgMode` for what it means. */
  bgThreshold: number;
  /** Drop components whose width OR height is below this. Filters speckle. */
  minSize: number;
  /** Expand each bbox by this many px after detection. */
  padding: number;
}

/**
 * Build a "is this pixel background" predicate over `src`. Cached
 * once so a multi-million-pixel pass doesn't re-derive the corner
 * average on every call.
 */
export function buildBackgroundTest(
  src: ImageData,
  bgMode: "corner" | "transparent",
  bgThreshold: number,
): (x: number, y: number) => boolean {
  const w = src.width;
  const h = src.height;
  const d = src.data;
  if (bgMode === "transparent") {
    const thr = Math.max(0, Math.min(255, bgThreshold));
    return (x, y) => d[(y * w + x) * 4 + 3] <= thr;
  }
  // Corner mode — 3×3 patch at each corner.
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
  const thr = Math.max(1, bgThreshold);
  const thrSq = thr * thr;
  return (x, y) => {
    const i = (y * w + x) * 4;
    const dr = d[i] - kr;
    const dg = d[i + 1] - kg;
    const db = d[i + 2] - kb;
    // Also treat fully-transparent pixels as background regardless
    // of color — JPEG backdrops sometimes carry a 1px alpha border
    // that confuses pure RGB distance.
    if (d[i + 3] <= 8) return true;
    return dr * dr + dg * dg + db * db <= thrSq;
  };
}

/**
 * Single-pass labeller. Walks every pixel; for each unlabeled
 * foreground pixel, BFS-flood its connected component and emit a
 * bbox. O(w·h) time + memory.
 */
export function detectObjects(src: ImageData, opts: DetectOpts): BBox[] {
  const w = src.width;
  const h = src.height;
  const isBg = buildBackgroundTest(src, opts.bgMode, opts.bgThreshold);
  const labels = new Uint32Array(w * h);
  const queue = new Int32Array(w * h);
  const boxes: BBox[] = [];

  let nextLabel = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] !== 0) continue;
      if (isBg(x, y)) {
        labels[idx] = 1;
        continue;
      }
      const bbox = floodComponent(labels, queue, w, h, idx, nextLabel++, isBg);
      const bw = bbox.maxX - bbox.minX + 1;
      const bh = bbox.maxY - bbox.minY + 1;
      if (bw < opts.minSize || bh < opts.minSize) continue;
      boxes.push(expand(bbox, opts.padding, w, h));
    }
  }

  // Reading order (top→bottom, then left→right). Row-tolerance bucket
  // keeps same-row objects together even when their y values jitter.
  const rowTol = Math.max(8, Math.floor(boxes.reduce((m, b) => Math.max(m, b.h), 0) / 2));
  boxes.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > rowTol) return dy;
    return a.x - b.x;
  });
  return boxes;
}

/**
 * Pick the object at a single pixel. Returns null when the seed pixel
 * is itself background, or when the flooded component is smaller than
 * `minSize`. Useful for click-to-select in the ImageEditor.
 */
export function selectObjectAt(
  src: ImageData,
  seedX: number,
  seedY: number,
  opts: DetectOpts,
): BBox | null {
  const w = src.width;
  const h = src.height;
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;
  const isBg = buildBackgroundTest(src, opts.bgMode, opts.bgThreshold);
  if (isBg(seedX, seedY)) return null;
  const labels = new Uint32Array(w * h);
  const queue = new Int32Array(w * h);
  const idx = seedY * w + seedX;
  const bbox = floodComponent(labels, queue, w, h, idx, 2, isBg);
  const bw = bbox.maxX - bbox.minX + 1;
  const bh = bbox.maxY - bbox.minY + 1;
  if (bw < opts.minSize || bh < opts.minSize) return null;
  return expand(bbox, opts.padding, w, h);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function floodComponent(
  labels: Uint32Array,
  queue: Int32Array,
  w: number,
  h: number,
  start: number,
  label: number,
  isBg: (x: number, y: number) => boolean,
): { minX: number; minY: number; maxX: number; maxY: number } {
  labels[start] = label;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  const startY = (start / w) | 0;
  const startX = start - startY * w;
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;
  while (head < tail) {
    const p = queue[head++];
    const py = (p / w) | 0;
    const px = p - py * w;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    // 4-neighborhood.
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
  return { minX, minY, maxX, maxY };
}

/**
 * Magic-wand flood — flood-fill from a seed pixel, including every
 * neighbor whose color is within `tolerance` of the seed (RGB) and
 * `alphaTolerance` of the seed's alpha. Returns a `Uint8Array` mask
 * of `width*height` bytes where `1` = inside the wand selection.
 *
 * Two modes:
 *   • contiguous=true  — standard flood-fill, only connected pixels.
 *   • contiguous=false — every pixel matching the seed color anywhere
 *     in the image (Photoshop's "Contiguous" checkbox off).
 *
 * 8-connectivity for the flood — diagonals are usually wanted when
 * selecting a region of similar color.
 */
export function magicWand(
  src: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  alphaTolerance: number,
  contiguous: boolean,
): Uint8Array {
  const w = src.width;
  const h = src.height;
  const mask = new Uint8Array(w * h);
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return mask;
  const d = src.data;
  const seedI = (seedY * w + seedX) * 4;
  const sr = d[seedI];
  const sg = d[seedI + 1];
  const sb = d[seedI + 2];
  const sa = d[seedI + 3];
  const tol = Math.max(0, Math.min(255, tolerance));
  const aTol = Math.max(0, Math.min(255, alphaTolerance));

  function matches(i: number): boolean {
    return (
      Math.abs(d[i] - sr) <= tol &&
      Math.abs(d[i + 1] - sg) <= tol &&
      Math.abs(d[i + 2] - sb) <= tol &&
      Math.abs(d[i + 3] - sa) <= aTol
    );
  }

  if (!contiguous) {
    // Scan every pixel; cheap because it's one pass.
    for (let p = 0; p < w * h; p++) {
      if (matches(p * 4)) mask[p] = 1;
    }
    return mask;
  }

  // Contiguous flood — 8-way BFS from the seed.
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seedIdx = seedY * w + seedX;
  queue[tail++] = seedIdx;
  mask[seedIdx] = 1;
  while (head < tail) {
    const p = queue[head++];
    const py = (p / w) | 0;
    const px = p - py * w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n]) continue;
        if (matches(n * 4)) {
          mask[n] = 1;
          queue[tail++] = n;
        }
      }
    }
  }
  return mask;
}

function expand(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  pad: number,
  w: number,
  h: number,
): BBox {
  const p = Math.max(0, pad | 0);
  const x = Math.max(0, bbox.minX - p);
  const y = Math.max(0, bbox.minY - p);
  return {
    x,
    y,
    w: Math.min(w, bbox.maxX + 1 + p) - x,
    h: Math.min(h, bbox.maxY + 1 + p) - y,
  };
}
