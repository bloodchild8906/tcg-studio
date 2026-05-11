/**
 * Template validation.
 *
 * Pure function — no React, no canvas — so it can run anywhere (panel, save
 * action, future server-side check). Returns a list of issues sorted by
 * severity then by layer.
 *
 * Severity ladder:
 *   error    — definitely wrong; export should refuse.
 *   warning  — probably wrong; export should warn.
 *   info     — heads-up; never blocks.
 *
 * The checks here are a starter set — spec sec 33 lists many more. We add
 * coverage as we add features (variant rules, asset library, schema engine).
 */
const MIN_DIMENSION = 5;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export function validateTemplate(template) {
    const issues = [];
    // ----- per-layer checks -----
    const seenZoneFieldKeys = new Map();
    for (const layer of template.layers) {
        issues.push(...checkLayerBounds(layer, template));
        issues.push(...checkLayerSize(layer));
        issues.push(...checkOpacity(layer));
        issues.push(...checkAppliesWhen(layer));
        if (layer.type === "zone") {
            issues.push(...checkZone(layer));
            const list = seenZoneFieldKeys.get(layer.fieldKey) ?? [];
            list.push(layer);
            seenZoneFieldKeys.set(layer.fieldKey, list);
        }
        if (layer.type === "image") {
            if (layer.assetId === null && (layer.src === null || layer.src === "")) {
                issues.push({
                    id: `image-empty:${layer.id}`,
                    severity: "info",
                    rule: "image_empty",
                    message: `"${layer.name}" has no asset or URL — placeholder will export.`,
                    layerId: layer.id,
                });
            }
        }
        if (layer.type === "text" && !layer.wrap) {
            // Crude detection: very long text in a narrow box is likely overflowing.
            // Real overflow requires measuring against the font metrics — that lands
            // in a future check that asks the canvas for a measurement.
            const charsPerPx = 0.5; // ~2px per char at default fontSize
            const estimatedWidth = layer.text.length * layer.fontSize * charsPerPx;
            if (estimatedWidth > layer.bounds.width * 1.6) {
                issues.push({
                    id: `text-overflow:${layer.id}`,
                    severity: "warning",
                    rule: "text_overflow",
                    message: `"${layer.name}" text likely overflows (wrap is off).`,
                    layerId: layer.id,
                });
            }
        }
    }
    // Duplicate field keys — only check once we have the full list.
    for (const [key, layers] of seenZoneFieldKeys) {
        if (layers.length > 1) {
            for (const l of layers) {
                issues.push({
                    id: `zone-dup-key:${l.id}:${key}`,
                    severity: "warning",
                    rule: "zone_duplicate_field_key",
                    message: `Field key "${key}" is used by ${layers.length} zones.`,
                    layerId: l.id,
                });
            }
        }
    }
    // ----- template-level checks -----
    if (template.layers.length === 0) {
        issues.push({
            id: "tpl-empty",
            severity: "info",
            rule: "template_empty",
            message: "Template has no layers.",
            layerId: null,
        });
    }
    if (template.bleed < 0) {
        issues.push({
            id: "tpl-bleed-negative",
            severity: "error",
            rule: "bleed_negative",
            message: "Bleed cannot be negative.",
            layerId: null,
        });
    }
    if (template.safeZone < 0) {
        issues.push({
            id: "tpl-safe-negative",
            severity: "error",
            rule: "safe_negative",
            message: "Safe zone cannot be negative.",
            layerId: null,
        });
    }
    return sortIssues(issues);
}
function checkLayerBounds(layer, t) {
    const { x, y, width, height } = layer.bounds;
    const out = [];
    if (x < 0 || y < 0 || x + width > t.size.width || y + height > t.size.height) {
        out.push({
            id: `oob:${layer.id}`,
            severity: "warning",
            rule: "layer_out_of_bounds",
            message: `"${layer.name}" extends beyond the card.`,
            layerId: layer.id,
        });
    }
    // Inside safe zone? Only meaningful when the layer is fully outside the safe
    // rect, not just a few pixels over.
    const safeOuterX = t.safeZone;
    const safeOuterY = t.safeZone;
    const safeInnerX = t.size.width - t.safeZone;
    const safeInnerY = t.size.height - t.safeZone;
    if (x + width <= safeOuterX ||
        y + height <= safeOuterY ||
        x >= safeInnerX ||
        y >= safeInnerY) {
        out.push({
            id: `outside-safe:${layer.id}`,
            severity: "info",
            rule: "layer_outside_safe_zone",
            message: `"${layer.name}" sits outside the safe zone — may be cut at print.`,
            layerId: layer.id,
        });
    }
    return out;
}
function checkLayerSize(layer) {
    const { width, height } = layer.bounds;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
        return [
            {
                id: `tiny:${layer.id}`,
                severity: "error",
                rule: "layer_too_small",
                message: `"${layer.name}" is below ${MIN_DIMENSION}×${MIN_DIMENSION}px — pick a real size.`,
                layerId: layer.id,
            },
        ];
    }
    return [];
}
function checkAppliesWhen(layer) {
    const rule = layer.appliesWhen;
    if (!rule)
        return [];
    const out = [];
    rule.conditions.forEach((cond, i) => {
        if (!cond.field || !/^[a-z][a-z0-9_]*$/.test(cond.field)) {
            out.push({
                id: `variant-bad-field:${layer.id}:${i}`,
                severity: "warning",
                rule: "variant_field_format",
                message: `"${layer.name}" — variant condition #${i + 1} field "${cond.field}" should be lowercase + underscores.`,
                layerId: layer.id,
            });
        }
        if ((cond.op === "in" || cond.op === "not_in") &&
            (!Array.isArray(cond.value) || cond.value.length === 0)) {
            out.push({
                id: `variant-empty-list:${layer.id}:${i}`,
                severity: "error",
                rule: "variant_list_empty",
                message: `"${layer.name}" — '${cond.op}' condition needs at least one value.`,
                layerId: layer.id,
            });
        }
        if ((cond.op === "equals" || cond.op === "not_equals") &&
            (cond.value === undefined || cond.value === null || cond.value === "")) {
            out.push({
                id: `variant-no-value:${layer.id}:${i}`,
                severity: "info",
                rule: "variant_value_empty",
                message: `"${layer.name}" — condition ${cond.op === "equals" ? "==" : "≠"} compares to an empty value.`,
                layerId: layer.id,
            });
        }
    });
    return out;
}
function checkOpacity(layer) {
    if (layer.opacity === 0 && layer.visible) {
        return [
            {
                id: `opacity-zero:${layer.id}`,
                severity: "info",
                rule: "layer_opacity_zero",
                message: `"${layer.name}" has opacity 0 — it's invisible. Hide it instead?`,
                layerId: layer.id,
            },
        ];
    }
    return [];
}
function checkZone(layer) {
    const out = [];
    if (!layer.fieldKey || layer.fieldKey.trim() === "") {
        out.push({
            id: `zone-empty-key:${layer.id}`,
            severity: "error",
            rule: "zone_field_key_empty",
            message: `"${layer.name}" has no field key — it won't bind to any data.`,
            layerId: layer.id,
        });
    }
    else if (!FIELD_KEY_PATTERN.test(layer.fieldKey)) {
        out.push({
            id: `zone-bad-key:${layer.id}`,
            severity: "warning",
            rule: "zone_field_key_format",
            message: `Field key "${layer.fieldKey}" should be lowercase + underscores (a-z, 0-9, _).`,
            layerId: layer.id,
        });
    }
    return out;
}
const SEVERITY_RANK = {
    error: 0,
    warning: 1,
    info: 2,
};
function sortIssues(issues) {
    return [...issues].sort((a, b) => {
        const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (sev !== 0)
            return sev;
        return a.message.localeCompare(b.message);
    });
}
export function summarize(issues) {
    const summary = { errors: 0, warnings: 0, infos: 0, total: issues.length };
    for (const i of issues) {
        if (i.severity === "error")
            summary.errors++;
        else if (i.severity === "warning")
            summary.warnings++;
        else
            summary.infos++;
    }
    return summary;
}
