import jsPDF from "jspdf";
import * as React from "react";
import type { Card, CardType } from "@/lib/apiTypes";
import type { CardTypeTemplate, Layer } from "@/types";
import { evaluateApplies, resolveLayer } from "@/lib/variants";
import { parentVisibilityGated } from "@/lib/groups";
import { resolveAssetUrl } from "@/lib/api";
import { renderToStaticMarkup } from "react-dom/server";
import { CardRender } from "@/components/CardRender";

/**
 * Print-sheet PDF export (sec 31).
 *
 * Strategy:
 *   1. For each card, build its CardTypeTemplate + dataJson.
 *   2. Render the card via CardRender (the same SVG renderer used for
 *      tile thumbnails) to a string.
 *   3. Inline-embed referenced images as data URLs so the SVG paints
 *      offline (jsPDF can't fetch external blob: URLs at print time).
 *   4. Rasterize the SVG to a PNG via the browser's <img> + <canvas>
 *      pipeline at the requested DPI.
 *   5. Lay out N images per page on a configurable paper size with
 *      crop marks at each corner.
 *
 * The print profile (sec 31.2) is supplied by the caller so the same
 * renderer covers letter / A4 / poker / bridge / oversized formats
 * without a special-case branch per format.
 */
export interface PrintSheetOptions {
  /** Canonical paper size, in points (1pt = 1/72 inch). */
  paper: { name: string; widthPt: number; heightPt: number };
  /** Target DPI for the rasterized card image. 300 is print-standard. */
  dpi: number;
  /** Page margin in points. Equal on all sides. */
  marginPt: number;
  /** Gap between cards on the sheet, in points. */
  gapPt: number;
  /** Whether to draw crop marks around each card. */
  cropMarks: boolean;
  /** Optional copyright / footer text printed below the sheet. */
  footer?: string;
}

export const PRINT_PROFILES: Record<string, PrintSheetOptions> = {
  letter_300dpi: {
    paper: { name: "letter", widthPt: 612, heightPt: 792 }, // 8.5×11 in
    dpi: 300,
    marginPt: 36, // 0.5 in
    gapPt: 9,
    cropMarks: true,
  },
  a4_300dpi: {
    paper: { name: "a4", widthPt: 595, heightPt: 842 },
    dpi: 300,
    marginPt: 36,
    gapPt: 9,
    cropMarks: true,
  },
};

/**
 * Build a PDF for `cards` rendered against `template` (one shared template
 * for all cards — typical case where every card uses the same card type).
 * Returns a Blob the caller can `URL.createObjectURL()` or save via a link.
 */
export async function exportPrintSheetPdf(args: {
  template: CardTypeTemplate;
  cards: Card[];
  cardType?: CardType;
  options?: Partial<PrintSheetOptions>;
}): Promise<Blob> {
  const opts: PrintSheetOptions = {
    ...PRINT_PROFILES.letter_300dpi,
    ...(args.options ?? {}),
  } as PrintSheetOptions;

  // Card size in inches (template.size is at print pixel dimensions —
  // template.size.width / dpi gives inches; we render at the requested
  // DPI so the rasterized image lands at the same physical size).
  // We assume the template was authored at 300 DPI by convention; if
  // not, the user can adjust the per-card width below by editing the
  // print profile to taste.
  const designDpi = 300;
  const cardWidthIn = args.template.size.width / designDpi;
  const cardHeightIn = args.template.size.height / designDpi;
  const cardWidthPt = cardWidthIn * 72;
  const cardHeightPt = cardHeightIn * 72;

  // How many cards fit per row / column / page given paper size, margins,
  // and gaps. Floor — we never overrun the paper.
  const usableW = opts.paper.widthPt - opts.marginPt * 2;
  const usableH = opts.paper.heightPt - opts.marginPt * 2;
  const cols = Math.max(1, Math.floor((usableW + opts.gapPt) / (cardWidthPt + opts.gapPt)));
  const rows = Math.max(1, Math.floor((usableH + opts.gapPt) / (cardHeightPt + opts.gapPt)));
  const perPage = cols * rows;

  // Center the grid on the page so margins are even regardless of the
  // floor truncation above.
  const gridW = cols * cardWidthPt + (cols - 1) * opts.gapPt;
  const gridH = rows * cardHeightPt + (rows - 1) * opts.gapPt;
  const gridX = (opts.paper.widthPt - gridW) / 2;
  const gridY = (opts.paper.heightPt - gridH) / 2;

  const pdf = new jsPDF({
    unit: "pt",
    format: [opts.paper.widthPt, opts.paper.heightPt],
    orientation: opts.paper.widthPt > opts.paper.heightPt ? "landscape" : "portrait",
  });

  for (let i = 0; i < args.cards.length; i++) {
    const pageIndex = Math.floor(i / perPage);
    const slot = i % perPage;
    if (slot === 0 && pageIndex > 0) pdf.addPage();
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = gridX + col * (cardWidthPt + opts.gapPt);
    const y = gridY + row * (cardHeightPt + opts.gapPt);

    // Rasterize this card. We render at print pixel size so the image
    // stays crisp at the requested DPI — `pixelRatio` would scale up
    // the canvas but the source SVG is resolution-independent already.
    const png = await rasterizeCardToPng({
      template: args.template,
      data: (args.cards[i].dataJson as Record<string, unknown> | null) ?? {},
      pixelWidth: Math.round(cardWidthIn * opts.dpi),
      pixelHeight: Math.round(cardHeightIn * opts.dpi),
    });

    pdf.addImage(png, "PNG", x, y, cardWidthPt, cardHeightPt, undefined, "FAST");

    if (opts.cropMarks) {
      drawCropMarks(pdf, x, y, cardWidthPt, cardHeightPt);
    }
  }

  if (opts.footer) {
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(opts.footer, opts.paper.widthPt / 2, opts.paper.heightPt - 12, {
      align: "center",
    });
  }

  return pdf.output("blob");
}

/**
 * Render a single card (template + per-card data) to a PNG data URL.
 *
 * Pipeline:
 *   1. ReactDOMServer.renderToStaticMarkup → SVG markup string.
 *   2. Inline external image hrefs as base64 data URIs (so the off-DOM
 *      <img> can resolve them without re-fetching with auth headers).
 *   3. Wrap the SVG in a Blob URL + load via Image().
 *   4. Draw onto an offscreen <canvas> at the target pixel size.
 *   5. canvas.toDataURL("image/png").
 */
export async function rasterizeCardToPng(args: {
  template: CardTypeTemplate;
  data: Record<string, unknown>;
  pixelWidth: number;
  pixelHeight: number;
}): Promise<string> {
  const svg = renderToStaticMarkup(
    React.createElement(CardRender, {
      template: args.template,
      data: args.data,
      width: args.template.size.width,
    }),
  );

  // Inline images so the off-DOM SVG can render them without going
  // back to the network mid-rasterize. We collect every layer's
  // resolved asset URL and replace the corresponding href with the
  // data URI. This is cheap enough — duplicates are deduped by the
  // image cache and most cards have ≤ 5 image refs.
  const visibleData = args.data;
  const collectAsset = (layer: Layer): string | null => {
    if (!evaluateApplies(layer.appliesWhen, visibleData)) return null;
    if (parentVisibilityGated(layer, args.template.layers, visibleData)) return null;
    const r = resolveLayer(layer, visibleData);
    if (r.type !== "image" && r.type !== "zone") return null;
    if (r.type === "image") {
      return resolveAssetUrl(r, visibleData) || null;
    }
    if (r.type === "zone" && r.binding === "image") {
      return resolveAssetUrl({ fieldKey: r.fieldKey }, visibleData) || null;
    }
    return null;
  };

  const urls = Array.from(
    new Set(
      args.template.layers
        .map(collectAsset)
        .filter((u): u is string => typeof u === "string" && u.length > 0),
    ),
  );
  const dataUriByUrl = await Promise.all(urls.map(async (u) => [u, await fetchAsDataUri(u)] as const));
  let inlined = svg;
  for (const [u, d] of dataUriByUrl) {
    if (!d) continue;
    // Replace exact href occurrences. URLs include tenant + token query
    // params, so they're long enough to be unambiguous in the markup.
    const escaped = escapeForRegex(u);
    inlined = inlined.replace(new RegExp(`href="${escaped}"`, "g"), `href="${d}"`);
  }

  return svgToPng(inlined, args.pixelWidth, args.pixelHeight);
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function svgToPng(svgMarkup: string, w: number, h: number): Promise<string> {
  const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg image failed to load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Draw four corner crop marks just outside the card rectangle.
 * Standard print-shop convention: 9pt long lines, 4.5pt offset from card edge.
 */
function drawCropMarks(pdf: jsPDF, x: number, y: number, w: number, h: number) {
  const len = 9;
  const offset = 4.5;
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.25);

  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ] as const;

  for (const [cx, cy] of corners) {
    const dx = cx === x ? -1 : 1;
    const dy = cy === y ? -1 : 1;
    // horizontal mark
    pdf.line(cx + dx * offset, cy, cx + dx * (offset + len), cy);
    // vertical mark
    pdf.line(cx, cy + dy * offset, cx, cy + dy * (offset + len));
  }
}
