import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { evaluateApplies, resolveLayer } from "@/lib/variants";
import { parentVisibilityGated } from "@/lib/groups";
import { resolveAssetUrl } from "@/lib/api";
/**
 * SVG-based card renderer.
 *
 * Used by every "small preview" surface: card tiles in the cards grid, the
 * card type tile in the card-types grid, the editor preview pane. We chose
 * SVG over Konva for tiles because:
 *   • we can have hundreds of these on a page (one per tile) and SVG is
 *     cheap — no per-element canvas state
 *   • each render is declarative — React diffing handles updates
 *   • SVG nests cleanly inside other layouts and scales without aliasing
 *
 * Konva remains the editor on the main canvas (transforms, drag, etc.).
 *
 * Inputs:
 *   • template — the CardTypeTemplate from the designer (frame + zones + …)
 *   • data — optional per-card data (merged with template.previewData). For
 *            an image layer with `fieldKey`, the source is resolved from
 *            this map. For a zone, the placeholder text is replaced with
 *            data[fieldKey] when present.
 *   • width — rendered SVG width in CSS px. Height derives from the card's
 *            aspect ratio (template.size).
 *
 * Variant rules are honored: layers whose `appliesWhen` doesn't match are
 * skipped entirely.
 */
export function CardRender({ template, data, width = 200, resolveAssetId, }) {
    const merged = useMemo(() => ({ ...(template.previewData ?? {}), ...(data ?? {}) }), [template.previewData, data]);
    const aspect = template.size.height / template.size.width;
    const height = Math.round(width * aspect);
    return (_jsxs("svg", { role: "img", "aria-label": template.name, viewBox: `0 0 ${template.size.width} ${template.size.height}`, width: width, height: height, preserveAspectRatio: "xMidYMid meet", 
        // Background card body — drawn first so layers paint over it.
        style: { display: "block", borderRadius: 6 }, children: [_jsx("defs", { children: _jsx("clipPath", { id: "cardClip", children: _jsx("rect", { x: "0", y: "0", width: template.size.width, height: template.size.height, rx: "14" }) }) }), _jsxs("g", { clipPath: "url(#cardClip)", children: [_jsx("rect", { x: "0", y: "0", width: template.size.width, height: template.size.height, fill: template.background }), template.layers.map((layer) => {
                        // Groups are organizational only — never drawn. Their effect
                        // (visibility / appliesWhen cascade) is applied to descendants
                        // via `parentVisibilityGated`.
                        if (layer.type === "group")
                            return null;
                        if (!layer.visible)
                            return null;
                        if (!evaluateApplies(layer.appliesWhen, merged))
                            return null;
                        // Walk up the parent chain — if any ancestor group is hidden
                        // or its appliesWhen rule fails, this layer is gated out.
                        if (parentVisibilityGated(layer, template.layers, merged))
                            return null;
                        // Variant resolution happens BEFORE the layer is drawn so the
                        // override (frame asset / fill / text / etc.) applies cleanly to
                        // every renderer path.
                        const resolved = resolveLayer(layer, merged);
                        return (_jsx(LayerSvg, { layer: resolved, data: merged, resolveAssetId: resolveAssetId }, layer.id));
                    })] })] }));
}
function LayerSvg({ layer, data, resolveAssetId, }) {
    const { x, y, width, height } = layer.bounds;
    const opacity = layer.opacity;
    const transform = layer.rotation !== 0
        ? `rotate(${layer.rotation} ${x} ${y})`
        : undefined;
    switch (layer.type) {
        case "rect": {
            // rgba(...) fills don't render reliably inside SVG fill="rgba(...)"
            // — but they do via the stroke + fill attribute when they're hex.
            // We forward whatever the user typed; rgba works.
            return (_jsx("rect", { x: x, y: y, width: width, height: height, rx: layer.cornerRadius, ry: layer.cornerRadius, fill: layer.fill || "transparent", stroke: layer.stroke ?? "none", strokeWidth: layer.strokeWidth, opacity: opacity, transform: transform }));
        }
        case "text": {
            // Resolve the inner text — pull from data when `text` looks like a
            // template `{{field}}`-style placeholder. For v0 we just render the
            // raw text; data interpolation can land later.
            if (layer.pathData) {
                return (_jsx(RenderTextPath, { layerId: layer.id, x: x, y: y, text: layer.text, fill: layer.fill, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontStyle: layer.fontStyle, align: layer.align, opacity: opacity, transform: transform, pathData: layer.pathData, pathSide: layer.pathSide, pathStartOffset: layer.pathStartOffset }));
            }
            return (_jsx(RenderText, { x: x, y: y, width: width, height: height, text: layer.text, fill: layer.fill, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontStyle: layer.fontStyle, align: layer.align, verticalAlign: layer.verticalAlign, opacity: opacity, transform: transform }));
        }
        case "image": {
            const src = resolveAssetUrl(layer, data, resolveAssetId);
            if (!src) {
                return (_jsx("g", { opacity: opacity, transform: transform, children: _jsx("rect", { x: x, y: y, width: width, height: height, fill: "rgba(58, 66, 88, 0.35)", stroke: "rgba(212, 162, 76, 0.4)", strokeDasharray: "6 5", strokeWidth: 1.5 }) }));
            }
            return (_jsx(ImageLayerSvg, { layer: layer, src: src, x: x, y: y, width: width, height: height, opacity: opacity, transform: transform }));
        }
        case "zone": {
            // Zones with text/number bindings render the bound value or the
            // placeholder; zones with image bindings use the same resolution as
            // image layers above (data → asset → fallback rect).
            const value = data[layer.fieldKey];
            const showText = layer.binding === "image"
                ? "" // image zones don't render text
                : value !== undefined && value !== null && value !== ""
                    ? String(value)
                    : layer.placeholder;
            if (layer.binding === "image") {
                const src = resolveAssetUrl({ fieldKey: layer.fieldKey }, data, resolveAssetId);
                return (_jsx("g", { opacity: opacity, transform: transform, children: src ? (_jsx("image", { href: src, x: x, y: y, width: width, height: height, preserveAspectRatio: "xMidYMid slice" })) : (_jsx("rect", { x: x, y: y, width: width, height: height, fill: "rgba(58, 66, 88, 0.35)", stroke: "rgba(212, 162, 76, 0.4)", strokeDasharray: "6 5", strokeWidth: 1.5 })) }));
            }
            return (_jsx(RenderText, { x: x, y: y, width: width, height: height, text: showText, fill: layer.fill, fontFamily: layer.fontFamily, fontSize: layer.fontSize, align: layer.align, verticalAlign: "middle", opacity: opacity, transform: transform }));
        }
        case "group": {
            // Groups never render — they're caught above in CardRender's
            // top-level loop. The case exists only to keep the switch
            // exhaustive for the type checker.
            return null;
        }
    }
}
/**
 * SVG image layer renderer that supports crop, offset, and the four fit
 * modes (contain / cover / fill / repeat).
 *
 * Strategy:
 *   • For `contain` / `cover` / `fill` we wrap the image in a nested
 *     <svg viewBox="cropX cropY cropW cropH"> with `preserveAspectRatio`
 *     set per fit mode. The inner <image> always points at 0,0 with the
 *     image's natural dimensions — the viewBox does the cropping.
 *   • For `repeat` we use SVG <pattern> + a filled <rect>. The pattern
 *     is sized by tileScale so each tile draws the cropped region at
 *     the user-specified scale.
 *   • Offset (`layer.offset`) shifts the destination coordinates of the
 *     wrapping <svg> / pattern origin so the image pans inside its
 *     bounds without changing the bounds themselves.
 *
 * Why a nested <svg> over `<image preserveAspectRatio + viewBox>` directly
 * on the parent: SVG's <image> element doesn't support a viewBox attribute
 * — only its parent <svg> does. Wrapping each image in its own <svg> gives
 * us per-image viewBoxes for cheap cropping, and lets the parent stay
 * unchanged.
 */
function ImageLayerSvg({ layer, src, x, y, width, height, opacity, transform, }) {
    const offsetX = layer.offset?.x ?? 0;
    const offsetY = layer.offset?.y ?? 0;
    const fit = layer.fit;
    const crop = layer.crop ?? null;
    // Repeat mode uses an SVG <pattern>. Each tile renders the (cropped)
    // image at tileScale * naturalCropSize destination pixels.
    if (fit === "repeat") {
        // We don't know natural dimensions in the SVG renderer (no Image()
        // probe here — that would make this component async). Use the crop
        // size as the tile dimension; if the user hasn't set a crop, we
        // need a sensible fallback. tileScale defaults to 1 — and we treat
        // the layer's bounds as a multiple-of-tile target. Without a crop
        // we fall back to a 64×64 tile (roughly card-icon scale) so the
        // pattern at least renders. Authors with non-square art should set
        // a crop or use cover instead.
        const tileScaleX = layer.tileScale?.x ?? 1;
        const tileScaleY = layer.tileScale?.y ?? 1;
        const tileBaseW = crop?.width ?? 64;
        const tileBaseH = crop?.height ?? 64;
        const tileW = Math.max(1, tileBaseW * tileScaleX);
        const tileH = Math.max(1, tileBaseH * tileScaleY);
        // A unique-enough id for this layer. Globally unique under the
        // current SVG defs since two images on the same card would have
        // different ids; even cross-card collisions are fine because each
        // card mounts its own <svg>.
        const patternId = `pat_${layer.id}`;
        return (_jsxs("g", { opacity: opacity, transform: transform, children: [_jsx("defs", { children: _jsx("pattern", { id: patternId, patternUnits: "userSpaceOnUse", x: x + offsetX, y: y + offsetY, width: tileW, height: tileH, children: crop ? (_jsx("svg", { x: 0, y: 0, width: tileW, height: tileH, viewBox: `${crop.x} ${crop.y} ${crop.width} ${crop.height}`, preserveAspectRatio: "none", overflow: "hidden", children: _jsx("image", { href: src, x: 0, y: 0, width: "100%", height: "100%" }) })) : (_jsx("image", { href: src, x: 0, y: 0, width: tileW, height: tileH, preserveAspectRatio: "none" })) }) }), _jsx("rect", { x: x, y: y, width: width, height: height, fill: `url(#${patternId})` })] }));
    }
    // Single-instance fit modes. Translate "fit" → SVG preserveAspectRatio.
    const par = fit === "contain"
        ? "xMidYMid meet"
        : fit === "fill"
            ? "none"
            : "xMidYMid slice"; // cover
    // When crop is set we need to (a) crop the source via inner viewBox
    // and (b) scale the cropped region into the destination box per `fit`.
    // The nested <svg> handles both — its viewBox crops, preserveAspectRatio
    // scales.
    if (crop) {
        return (_jsx("g", { opacity: opacity, transform: transform, children: _jsx("svg", { x: x + offsetX, y: y + offsetY, width: width, height: height, viewBox: `${crop.x} ${crop.y} ${crop.width} ${crop.height}`, preserveAspectRatio: par, overflow: "hidden", children: _jsx("image", { href: src, x: 0, y: 0, width: "100%", height: "100%" }) }) }));
    }
    // No crop — the simplest path. Apply offset by shifting <image> coords;
    // overflow stays clipped by the parent card clipPath so a positive
    // offset still hides what slides past the layer edge.
    return (_jsx("image", { href: src, x: x + offsetX, y: y + offsetY, width: width, height: height, preserveAspectRatio: par, opacity: opacity, transform: transform }));
}
/**
 * Lightweight wrapping <text>. SVG <text> doesn't auto-wrap, so we split
 * on words and emit <tspan>s, breaking when an estimated width exceeds
 * `width`. This is a heuristic — the editor uses Konva.Text for accurate
 * layout. For tile thumbnails the heuristic is fine.
 */
function RenderText({ x, y, width, height, text, fill, fontFamily, fontSize, fontStyle, align, verticalAlign, opacity, transform, }) {
    const lines = useMemo(() => wrap(text, width, fontSize), [text, width, fontSize]);
    const lineHeight = Math.round(fontSize * 1.2);
    const totalHeight = lines.length * lineHeight;
    // Vertical alignment — y is the baseline of the first line.
    const offsetY = verticalAlign === "top"
        ? fontSize
        : verticalAlign === "bottom"
            ? height - totalHeight + fontSize
            : (height - totalHeight) / 2 + fontSize;
    const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
    const anchorX = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
    const isItalic = fontStyle?.includes("italic");
    const isBold = fontStyle?.includes("bold");
    return (_jsx("text", { x: anchorX, y: y + offsetY, fontFamily: fontFamily, fontSize: fontSize, fontStyle: isItalic ? "italic" : "normal", fontWeight: isBold ? 700 : 400, fill: fill, textAnchor: anchor, opacity: opacity, transform: transform, style: { whiteSpace: "pre" }, children: lines.map((line, i) => (_jsx("tspan", { x: anchorX, dy: i === 0 ? 0 : lineHeight, children: line }, i))) }));
}
/**
 * SVG textPath renderer — flows text along an arbitrary path.
 *
 * The path data is in the LAYER's local coords (origin at bounds.x,
 * bounds.y) so we wrap the textPath in a `<g transform="translate(x,y)">`
 * to make those coords work without forcing authors to re-translate
 * every path. SVG's `<textPath>` resolves coords in the SVG document
 * space, so the wrapping group keeps everything consistent with the
 * rest of the layer pipeline.
 *
 * Each layer gets its own `<defs>` path id derived from the layer id.
 * Two layers with the same id can't coexist in the same document, so
 * the id collision is impossible.
 *
 * Alignment: SVG's textPath uses `text-anchor` on the parent `<text>`
 * to position text along the path. We map our `align: left | center
 * | right` to the equivalent text-anchor + startOffset pair. When the
 * caller specifies `pathStartOffset`, we honor it directly (it wins
 * over the alignment-derived offset).
 */
function RenderTextPath({ layerId, x, y, text, fill, fontFamily, fontSize, fontStyle, align, opacity, transform, pathData, pathSide, pathStartOffset, }) {
    const isItalic = fontStyle?.includes("italic");
    const isBold = fontStyle?.includes("bold");
    const pathId = `path_${layerId}`;
    // Map align → SVG text-anchor + a default startOffset. The caller's
    // explicit `pathStartOffset` wins, so a card author can fine-tune
    // when the heuristic doesn't land exactly on the curve they want.
    const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
    const defaultOffset = align === "center" ? "50%" : align === "right" ? "100%" : "0%";
    const startOffset = typeof pathStartOffset === "number" ? `${pathStartOffset}%` : defaultOffset;
    return (_jsxs("g", { transform: transform ? `${transform} translate(${x} ${y})` : `translate(${x} ${y})`, children: [_jsx("defs", { children: _jsx("path", { id: pathId, d: pathData, fill: "none" }) }), _jsx("text", { fontFamily: fontFamily, fontSize: fontSize, fontStyle: isItalic ? "italic" : "normal", fontWeight: isBold ? 700 : 400, fill: fill, textAnchor: anchor, opacity: opacity, children: _jsx("textPath", { href: `#${pathId}`, startOffset: startOffset, ...(pathSide === "right" ? { side: "right" } : {}), children: text }) })] }));
}
/**
 * Word-boundary line wrap. The character-width approximation assumes a 0.55
 * average char/em ratio, which lands close enough for serif and sans display
 * fonts. Long words longer than `width` are broken mid-word.
 */
function wrap(text, width, fontSize) {
    if (!text)
        return [""];
    const charWidth = fontSize * 0.55;
    const maxChars = Math.max(1, Math.floor(width / charWidth));
    const lines = [];
    for (const paragraph of text.split(/\n/)) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let current = "";
        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length <= maxChars) {
                current = candidate;
                continue;
            }
            if (current) {
                lines.push(current);
                current = "";
            }
            if (word.length > maxChars) {
                // Hard-break a giant token.
                for (let i = 0; i < word.length; i += maxChars) {
                    lines.push(word.slice(i, i + maxChars));
                }
            }
            else {
                current = word;
            }
        }
        if (current)
            lines.push(current);
        if (paragraph === "")
            lines.push("");
    }
    return lines.length ? lines : [""];
}
