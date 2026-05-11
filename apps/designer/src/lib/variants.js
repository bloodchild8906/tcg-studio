/**
 * Variant rule evaluator (spec sec 21).
 *
 * Pure module — no React, no store. Given a rule and a flat data object,
 * decides whether the layer it's attached to should apply.
 *
 * Type coercion: comparisons work field-vs-value with a forgiving equality
 * check. If both sides parse as numbers we compare as numbers; otherwise we
 * fall through to string equality. This matches what designers actually want
 * ("cost equals 3" should match whether the data has 3 or "3").
 */
/**
 * Decide if a layer applies. Returns true when:
 *   - the rule is null/undefined (no rule = always applies);
 *   - the rule has zero conditions (vacuous = always applies — explicit choice
 *     for UX, not a strict logical reading);
 *   - the rule's match strategy succeeds against `data`.
 */
export function evaluateApplies(rule, data) {
    if (!rule)
        return true;
    if (!rule.conditions || rule.conditions.length === 0)
        return true;
    return rule.match === "any"
        ? rule.conditions.some((c) => evaluateCondition(c, data))
        : rule.conditions.every((c) => evaluateCondition(c, data));
}
export function evaluateCondition(cond, data) {
    const present = Object.prototype.hasOwnProperty.call(data, cond.field);
    const lhs = present ? data[cond.field] : undefined;
    switch (cond.op) {
        case "exists":
            return present && !isEmpty(lhs);
        case "missing":
            return !present || isEmpty(lhs);
        case "equals":
            return looseEqual(lhs, cond.value);
        case "not_equals":
            return !looseEqual(lhs, cond.value);
        case "in":
            return Array.isArray(cond.value)
                ? cond.value.some((v) => looseEqual(lhs, v))
                : false;
        case "not_in":
            return Array.isArray(cond.value)
                ? !cond.value.some((v) => looseEqual(lhs, v))
                : true;
    }
}
function isEmpty(v) {
    return v === undefined || v === null || v === "";
}
function looseEqual(a, b) {
    if (a === b)
        return true;
    if (a === undefined || a === null || b === undefined || b === null)
        return false;
    // Try number comparison if both sides are number-coercible.
    const an = toNum(a);
    const bn = toNum(b);
    if (an !== null && bn !== null)
        return an === bn;
    // Try boolean comparison for "true"/"false" strings.
    const ab = toBool(a);
    const bb = toBool(b);
    if (ab !== null && bb !== null)
        return ab === bb;
    // Fall back to string comparison.
    return String(a) === String(b);
}
function toNum(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        return Number(v);
    }
    return null;
}
function toBool(v) {
    if (typeof v === "boolean")
        return v;
    if (typeof v === "string") {
        const lower = v.toLowerCase();
        if (lower === "true")
            return true;
        if (lower === "false")
            return false;
    }
    return null;
}
/**
 * Resolve a layer against the current card data.
 *
 * Walks the layer's `variants` (in order, first match wins) and returns
 * the layer with any matching override merged on top. The merge is shallow:
 * overrides replace top-level keys but don't deep-merge nested objects.
 * (Bounds is the only nested object that matters in practice; if a variant
 * wants to move a layer it sets `bounds` whole.)
 *
 * Pure — no React, no store. Used by CardRender (SVG), CanvasStage (Konva)
 * and any future export pipeline so they all see the same resolved layer.
 */
export function resolveLayer(layer, data) {
    const variants = layer.variants;
    if (!variants || variants.length === 0)
        return layer;
    for (const v of variants) {
        if (matchesVariant(v, data)) {
            return { ...layer, ...v.overrides };
        }
    }
    return layer;
}
/**
 * Same matching semantics as `evaluateApplies` but operates on a `LayerVariant`.
 * Empty condition list is treated as "match everything" (the same convention
 * used by `appliesWhen` for ergonomic UX).
 */
export function matchesVariant(variant, data) {
    const conditions = variant.conditions ?? [];
    if (conditions.length === 0)
        return true;
    return variant.match === "any"
        ? conditions.some((c) => evaluateCondition(c, data))
        : conditions.every((c) => evaluateCondition(c, data));
}
/** Display label used by the inspector and validation messages. */
export function describeOperator(op) {
    return {
        equals: "equals",
        not_equals: "≠",
        in: "in",
        not_in: "not in",
        exists: "exists",
        missing: "missing",
    }[op];
}
