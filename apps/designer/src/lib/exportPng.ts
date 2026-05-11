import type Konva from "konva";
import type { CardTypeTemplate } from "@/types";

/**
 * Export the current canvas to a PNG.
 *
 * The Konva stage is the source of truth for what the user sees. To get a
 * print-ready export at the design pixel size (regardless of current zoom),
 * we ask Konva for an `image` of the *card* group at scale 1, with a viewport
 * temporarily reset to origin.
 *
 * Caller must pass:
 *   - the Stage ref so we can access the underlying `Konva.Stage`
 *   - the cardLayerId (Konva Layer node id) we want to export — this is the
 *     "card group" only, *not* the surrounding overlays (grid, bleed, safe).
 *
 * The export does not include hidden layers because the renderer already
 * skips them.
 */
export function exportCanvasToPng(
  stage: Konva.Stage,
  cardLayerNodeId: string,
  template: CardTypeTemplate,
): void {
  const node = stage.findOne(`#${cardLayerNodeId}`);
  if (!node) {
    console.error("exportCanvasToPng: card layer not found", cardLayerNodeId);
    return;
  }

  // Konva.Layer.toDataURL takes pixelRatio (rendered scale) plus optional clip.
  // We render the card at its declared design size. With pixelRatio=1 we get
  // exactly `template.size.width × template.size.height` px.
  const dataUrl = (node as Konva.Layer).toDataURL({
    pixelRatio: 1,
    x: 0,
    y: 0,
    width: template.size.width,
    height: template.size.height,
    mimeType: "image/png",
  });

  const safe = template.id.replace(/[^a-z0-9_-]+/gi, "_");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${safe}.preview.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
