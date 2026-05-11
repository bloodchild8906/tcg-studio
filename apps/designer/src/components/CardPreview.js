import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDesigner } from "@/store/designerStore";
import { sampleTemplate } from "@/data/sampleTemplate";
import { CardRender } from "@/components/CardRender";
/**
 * Card preview — the small renderer used in tiles, the editor preview pane,
 * and anywhere else we need to show "what this card looks like".
 *
 * Resolves the card's CardType, walks up to its active template (held in
 * the designer store as the *currently-edited* template if it matches the
 * active card type), then renders via `CardRender` with the card's dataJson
 * merged in. When no template is reachable (offline / fresh card type),
 * falls back to the bundled sample template so the tile isn't empty.
 *
 * Set + collector number badge floats over the top-right corner.
 */
export function CardPreview({ card, set, width = 180, }) {
    const template = useTemplateForCard(card);
    return (_jsxs("div", { className: "relative", children: [_jsx(CardRender, { template: template, data: card.dataJson ?? {}, width: width }), set && (_jsxs("span", { className: "absolute right-2 top-2 rounded-sm bg-black/65 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-accent-300", title: set.name, style: { border: "1px solid rgba(212,162,76,0.4)" }, children: [set.code, card.collectorNumber !== null && card.collectorNumber !== undefined && (_jsxs("span", { className: "text-ink-300", children: [" \u00B7 ", String(card.collectorNumber).padStart(3, "0")] }))] }))] }));
}
/**
 * Look up a usable template for `card`. Resolution order:
 *   1. If the card's cardType is currently active in the designer AND the
 *      designer's editor has a loaded template, use the in-memory copy
 *      (so unsaved layout edits show in tiles).
 *   2. The bundled sampleTemplate so tiles aren't blank during early dev.
 *
 * Once we cache fetched templates per cardTypeId in the store, this hook
 * grows into a real lookup against that cache.
 */
function useTemplateForCard(card) {
    const activeCardTypeId = useDesigner((s) => s.activeCardTypeId);
    const editorTemplate = useDesigner((s) => s.template);
    if (activeCardTypeId === card.cardTypeId) {
        return editorTemplate;
    }
    return sampleTemplate;
}
/**
 * Render the active card type's template at preview size — used by the
 * Card Types grid to give each tile a real frame thumbnail. Pulls the
 * editor's in-memory template when the card type is active so unsaved
 * edits surface immediately.
 */
export function CardTypeThumbnail({ cardType, width = 200, }) {
    const activeCardTypeId = useDesigner((s) => s.activeCardTypeId);
    const editorTemplate = useDesigner((s) => s.template);
    const template = activeCardTypeId === cardType.id ? editorTemplate : sampleTemplate;
    return _jsx(CardRender, { template: template, width: width });
}
