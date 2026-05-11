import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useDesigner, selectSelectedLayer } from "@/store/designerStore";
import { useAssetPicker } from "@/components/AssetPicker";
import { assetBlobUrl, getAsset as apiGetAsset } from "@/lib/api";
import { describeOperator, evaluateApplies, matchesVariant } from "@/lib/variants";
/**
 * Properties inspector (right panel).
 *
 * Renders different field groups based on the selected layer's type. Common
 * fields (name, position, size, rotation, visibility, lock, opacity) appear at
 * the top; type-specific fields below.
 *
 * Each input writes back through `updateLayer`. We don't debounce here — the
 * store mutations are cheap and the canvas re-render is a single Konva.draw().
 *
 * Why string→number coercion is centralized: HTML number inputs can produce
 * empty strings during edits. Treating those as "leave the value alone" stops
 * a user mid-typing from accidentally clearing a value.
 */
export function Inspector() {
    const layer = useDesigner(selectSelectedLayer);
    const updateLayer = useDesigner((s) => s.updateLayer);
    const commit = useDesigner((s) => s.commit);
    const selectedCount = useDesigner((s) => s.selectedLayerIds.length);
    if (!layer) {
        return (_jsxs("div", { className: "p-3", children: [_jsx(PanelHeader, { title: "Inspector" }), _jsx("p", { className: "px-1 py-6 text-center text-xs text-ink-400", children: "Select a layer to edit its properties." })] }));
    }
    function patch(p) {
        if (!layer)
            return;
        updateLayer(layer.id, p);
    }
    return (_jsxs("div", { className: "flex h-full flex-col", onFocusCapture: (e) => {
            // Snapshot history once when the user starts interacting with this panel.
            // Capture phase fires before the focused element's own onFocus, and the
            // event bubbles up here from any nested input. We snapshot only when
            // the focus moves *into* an editable element from outside the panel.
            const target = e.target;
            const related = e.relatedTarget;
            const wasOutside = !related || !e.currentTarget.contains(related);
            const isEditable = target?.tagName === "INPUT" ||
                target?.tagName === "SELECT" ||
                target?.tagName === "TEXTAREA";
            if (wasOutside && isEditable)
                commit();
        }, children: [_jsx(PanelHeader, { title: "Inspector", subtitle: layer.type }), selectedCount > 1 && (_jsxs("div", { className: "border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-300", children: [selectedCount, " layers selected \u2014 editing primary; transforms apply to all."] })), _jsxs("div", { className: "flex-1 overflow-y-auto p-3 space-y-4", children: [_jsxs(FieldGroup, { title: "Layer", children: [_jsx(Field, { label: "Name", children: _jsx(TextInput, { value: layer.name, onChange: (v) => patch({ name: v }) }) }), _jsx(Field, { label: "Type", children: _jsx(ReadOnly, { value: layer.type }) })] }), _jsxs(FieldGroup, { title: "Transform", children: [_jsxs(Row, { children: [_jsx(Field, { label: "X", children: _jsx(NumberInput, { value: layer.bounds.x, onChange: (v) => patch({ bounds: { ...layer.bounds, x: v } }) }) }), _jsx(Field, { label: "Y", children: _jsx(NumberInput, { value: layer.bounds.y, onChange: (v) => patch({ bounds: { ...layer.bounds, y: v } }) }) })] }), _jsxs(Row, { children: [_jsx(Field, { label: "W", children: _jsx(NumberInput, { value: layer.bounds.width, min: 1, onChange: (v) => patch({
                                                bounds: { ...layer.bounds, width: Math.max(1, v) },
                                            }) }) }), _jsx(Field, { label: "H", children: _jsx(NumberInput, { value: layer.bounds.height, min: 1, onChange: (v) => patch({
                                                bounds: { ...layer.bounds, height: Math.max(1, v) },
                                            }) }) })] }), _jsxs(Row, { children: [_jsx(Field, { label: "Rotation\u00B0", children: _jsx(NumberInput, { value: layer.rotation, onChange: (v) => patch({ rotation: v }) }) }), _jsx(Field, { label: "Opacity", children: _jsx(NumberInput, { value: layer.opacity, min: 0, max: 1, step: 0.05, onChange: (v) => patch({ opacity: Math.max(0, Math.min(1, v)) }) }) })] }), _jsxs(Row, { children: [_jsx(Toggle, { label: "Visible", checked: layer.visible, onChange: (v) => patch({ visible: v }) }), _jsx(Toggle, { label: "Locked", checked: layer.locked, onChange: (v) => patch({ locked: v }) })] })] }), _jsx(AppliesWhenFields, { layer: layer, patch: patch }), layer.type === "rect" && _jsx(RectFields, { layer: layer, patch: patch }), layer.type === "text" && _jsx(TextFields, { layer: layer, patch: patch }), layer.type === "image" && _jsx(ImageFields, { layer: layer, patch: patch }), layer.type === "zone" && _jsx(ZoneFields, { layer: layer, patch: patch }), _jsx(VariantsFields, { layer: layer, patch: patch })] })] }));
}
/* ---------------------------------------------------------------------- */
/* Per-layer variant overrides                                            */
/* ---------------------------------------------------------------------- */
function VariantsFields({ layer, patch, }) {
    const previewData = useDesigner((s) => s.template.previewData ?? {});
    const variants = layer.variants ?? [];
    function setVariants(next) {
        patch({ variants: next.length === 0 ? undefined : next });
    }
    function addVariant() {
        setVariants([
            ...variants,
            {
                name: `Variant ${variants.length + 1}`,
                match: "all",
                conditions: [{ field: "faction", op: "equals", value: "" }],
                overrides: {},
            },
        ]);
    }
    function patchVariant(i, p) {
        setVariants(variants.map((v, idx) => (idx === i ? { ...v, ...p } : v)));
    }
    function moveVariant(i, dir) {
        const j = i + dir;
        if (j < 0 || j >= variants.length)
            return;
        const next = [...variants];
        [next[i], next[j]] = [next[j], next[i]];
        setVariants(next);
    }
    function removeVariant(i) {
        setVariants(variants.filter((_, idx) => idx !== i));
    }
    return (_jsxs(FieldGroup, { title: `Variants (${variants.length})`, children: [_jsx("p", { className: "text-[10px] text-ink-500", children: "First-match-wins. Each variant overrides specific properties when its rule matches the current preview / card data." }), variants.length === 0 ? (_jsx("p", { className: "px-1 text-[11px] text-ink-500", children: "No variants on this layer." })) : (_jsx("ul", { className: "space-y-2", children: variants.map((v, i) => {
                    const matching = matchesVariant(v, previewData);
                    return (_jsx(VariantRow, { variant: v, index: i, total: variants.length, matching: matching, layer: layer, onChange: (p) => patchVariant(i, p), onMoveUp: () => moveVariant(i, -1), onMoveDown: () => moveVariant(i, 1), onDelete: () => removeVariant(i) }, i));
                }) })), _jsx("button", { type: "button", onClick: addVariant, className: "mt-1 inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700", children: "+ Add variant" })] }));
}
function VariantRow({ variant, index, total, matching, layer, onChange, onMoveUp, onMoveDown, onDelete, }) {
    function setConditions(conditions) {
        onChange({ conditions });
    }
    function setOverride(key, value) {
        const overrides = { ...variant.overrides };
        if (value === undefined || value === "" || value === null) {
            delete overrides[key];
        }
        else {
            overrides[key] = value;
        }
        onChange({ overrides });
    }
    const overrideKeys = Object.keys(variant.overrides);
    return (_jsxs("li", { className: "space-y-1.5 rounded border border-ink-700 bg-ink-900/40 p-2", children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "text", value: variant.name ?? "", onChange: (e) => onChange({ name: e.target.value }), placeholder: `Variant ${index + 1}`, className: "flex-1 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-100" }), _jsx("span", { className: [
                            "rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                            matching
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                : "border-ink-700 bg-ink-800 text-ink-400",
                        ].join(" "), title: matching ? "Active under current preview data" : "Not matching", children: matching ? "active" : "—" }), _jsx("button", { type: "button", onClick: onMoveUp, disabled: index === 0, className: "inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30", title: "Move up", children: "\u2191" }), _jsx("button", { type: "button", onClick: onMoveDown, disabled: index === total - 1, className: "inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30", title: "Move down", children: "\u2193" }), _jsx("button", { type: "button", onClick: onDelete, className: "inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-danger-500/20 hover:text-danger-500", title: "Delete", children: "\u00D7" })] }), _jsxs("div", { children: [_jsxs("div", { className: "mb-1 flex items-center gap-2", children: [_jsx("span", { className: "text-[10px] uppercase tracking-wider text-ink-500", children: "When" }), _jsxs("select", { value: variant.match, onChange: (e) => onChange({ match: e.target.value }), className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0 text-[10px] text-ink-100", children: [_jsx("option", { value: "all", children: "all of" }), _jsx("option", { value: "any", children: "any of" })] })] }), _jsx("ul", { className: "space-y-1", children: variant.conditions.map((cond, i) => (_jsx(ConditionRow, { cond: cond, onChange: (next) => {
                                const list = [...variant.conditions];
                                list[i] = next;
                                setConditions(list);
                            }, onDelete: () => setConditions(variant.conditions.filter((_, j) => j !== i)) }, i))) }), _jsx("button", { type: "button", onClick: () => setConditions([
                            ...variant.conditions,
                            { field: "faction", op: "equals", value: "" },
                        ]), className: "mt-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-100 hover:bg-ink-700", children: "+ condition" })] }), _jsxs("div", { className: "border-t border-ink-800 pt-1.5", children: [_jsx("p", { className: "mb-1 text-[10px] uppercase tracking-wider text-ink-500", children: "Then override" }), _jsx(OverrideEditor, { layer: layer, overrides: variant.overrides, onChange: setOverride }), overrideKeys.length === 0 && (_jsx("p", { className: "mt-1 text-[10px] text-ink-600", children: "No overrides yet \u2014 variant matches but renders the base layer." }))] })] }));
}
/**
 * Layer-type-aware override editor. Surfaces the most useful properties
 * per layer type instead of a generic "key/value" form. Picking a value
 * sets the override; clearing it removes the key.
 */
function OverrideEditor({ layer, overrides, onChange, }) {
    const picker = useAssetPicker((asset) => onChange("assetId", asset.id));
    const get = (k) => overrides[k];
    if (layer.type === "image") {
        const assetId = typeof get("assetId") === "string" ? get("assetId") : null;
        const src = typeof get("src") === "string" ? get("src") : "";
        return (_jsxs("div", { className: "space-y-1.5", children: [_jsx(Field, { label: "Asset id (frame art)", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] [background-size:6px_6px]", children: assetId && (_jsx("img", { src: assetBlobUrl(assetId), alt: "", className: "max-h-full max-w-full object-contain" })) }), _jsx("button", { type: "button", onClick: picker.open, className: "rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700", children: assetId ? "Change…" : "Pick…" }), assetId && (_jsx("button", { type: "button", onClick: () => onChange("assetId", undefined), className: "rounded border border-transparent px-1.5 py-1 text-[10px] text-ink-400 hover:border-ink-700 hover:bg-ink-800", children: "clear" })), picker.element] }) }), _jsx(Field, { label: "External URL (overrides asset)", children: _jsx(TextInput, { value: src, placeholder: "https://\u2026", onChange: (v) => onChange("src", v.trim() || undefined) }) })] }));
    }
    if (layer.type === "rect") {
        return (_jsxs("div", { className: "space-y-1.5", children: [_jsx(Field, { label: "Fill", children: _jsx(ColorOverride, { value: typeof get("fill") === "string" ? get("fill") : "", onChange: (v) => onChange("fill", v || undefined) }) }), _jsx(Field, { label: "Stroke", children: _jsx(ColorOverride, { value: typeof get("stroke") === "string" ? get("stroke") : "", onChange: (v) => onChange("stroke", v || undefined) }) }), _jsx(Field, { label: "Stroke width", children: _jsx(NumberOverride, { value: typeof get("strokeWidth") === "number" ? get("strokeWidth") : "", onChange: (v) => onChange("strokeWidth", v) }) })] }));
    }
    if (layer.type === "text") {
        return (_jsxs("div", { className: "space-y-1.5", children: [_jsx(Field, { label: "Text", children: _jsx(TextInput, { value: typeof get("text") === "string" ? get("text") : "", onChange: (v) => onChange("text", v || undefined) }) }), _jsx(Field, { label: "Color", children: _jsx(ColorOverride, { value: typeof get("fill") === "string" ? get("fill") : "", onChange: (v) => onChange("fill", v || undefined) }) }), _jsx(Field, { label: "Font size", children: _jsx(NumberOverride, { value: typeof get("fontSize") === "number" ? get("fontSize") : "", onChange: (v) => onChange("fontSize", v) }) })] }));
    }
    if (layer.type === "zone") {
        return (_jsxs("div", { className: "space-y-1.5", children: [_jsx(Field, { label: "Placeholder", children: _jsx(TextInput, { value: typeof get("placeholder") === "string" ? get("placeholder") : "", onChange: (v) => onChange("placeholder", v || undefined) }) }), _jsx(Field, { label: "Color", children: _jsx(ColorOverride, { value: typeof get("fill") === "string" ? get("fill") : "", onChange: (v) => onChange("fill", v || undefined) }) })] }));
    }
    return null;
}
function ColorOverride({ value, onChange, }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: normalizeHex(value), onChange: (e) => onChange(e.target.value), className: "h-6 w-8 cursor-pointer rounded border border-ink-700 bg-ink-900 p-0.5" }), _jsx("input", { type: "text", value: value, placeholder: "(unchanged)", onChange: (e) => onChange(e.target.value), className: "block flex-1 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-ink-100" })] }));
}
function NumberOverride({ value, onChange, }) {
    return (_jsx("input", { type: "number", value: value === "" ? "" : value, onChange: (e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
        }, placeholder: "(unchanged)", className: "block w-full rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-100" }));
}
/* ---------------------------------------------------------------------- */
/* Variant rule editor                                                    */
/* ---------------------------------------------------------------------- */
const OPERATORS = [
    "equals",
    "not_equals",
    "in",
    "not_in",
    "exists",
    "missing",
];
function AppliesWhenFields({ layer, patch, }) {
    const previewData = useDesigner((s) => s.template.previewData ?? {});
    const rule = layer.appliesWhen ?? null;
    const enabled = !!rule;
    const matches = evaluateApplies(rule, previewData);
    function setRule(next) {
        patch({ appliesWhen: next });
    }
    function setConditions(conditions) {
        if (!rule)
            return;
        setRule({ ...rule, conditions });
    }
    return (_jsxs(FieldGroup, { title: "Applies when", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Toggle, { label: enabled ? "Conditional" : "Always visible", checked: enabled, onChange: (v) => setRule(v ? { match: "all", conditions: [] } : null) }), enabled && (_jsx("span", { className: [
                            "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                            matches
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                : "border-ink-700 bg-ink-800 text-ink-400",
                        ].join(" "), title: matches ? "Layer is rendering with current preview data." : "Layer is hidden by its rule.", children: matches ? "matches" : "no match" }))] }), enabled && rule && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "Match", children: _jsx(Select, { value: rule.match, options: ["all", "any"], onChange: (v) => setRule({ ...rule, match: v }) }) }), _jsxs("ul", { className: "space-y-1", children: [rule.conditions.length === 0 && (_jsx("li", { className: "text-[11px] text-ink-500", children: "No conditions yet \u2014 layer always applies." })), rule.conditions.map((cond, i) => (_jsx(ConditionRow, { cond: cond, onChange: (next) => {
                                    const list = [...rule.conditions];
                                    list[i] = next;
                                    setConditions(list);
                                }, onDelete: () => {
                                    const list = rule.conditions.filter((_, j) => j !== i);
                                    setConditions(list);
                                } }, i)))] }), _jsx("button", { type: "button", onClick: () => setConditions([
                            ...rule.conditions,
                            { field: "faction", op: "equals", value: "" },
                        ]), className: "mt-1 inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700", children: "+ Add condition" })] }))] }));
}
function ConditionRow({ cond, onChange, onDelete, }) {
    // For exists/missing, no value input is shown — the field name is enough.
    const wantsValue = cond.op !== "exists" && cond.op !== "missing";
    const wantsList = cond.op === "in" || cond.op === "not_in";
    return (_jsxs("li", { className: "grid grid-cols-[3fr_2fr_3fr_auto] items-center gap-1", children: [_jsx("input", { type: "text", value: cond.field, onChange: (e) => onChange({ ...cond, field: e.target.value.replace(/\s+/g, "_") }), placeholder: "field", className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-ink-100 placeholder:text-ink-600" }), _jsx("select", { value: cond.op, onChange: (e) => onChange({ ...cond, op: e.target.value }), className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] text-ink-100", children: OPERATORS.map((op) => (_jsx("option", { value: op, children: describeOperator(op) }, op))) }), wantsValue ? (_jsx("input", { type: "text", value: wantsList
                    ? Array.isArray(cond.value)
                        ? cond.value.join(", ")
                        : ""
                    : String(cond.value ?? ""), onChange: (e) => onChange({
                    ...cond,
                    value: wantsList
                        ? e.target.value
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean)
                        : e.target.value,
                }), placeholder: wantsList ? "Fire, Water, …" : "value", className: "rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100 placeholder:text-ink-600" })) : (_jsx("span", { className: "text-[10px] text-ink-500", children: "\u2014" })), _jsx("button", { type: "button", onClick: onDelete, className: "inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-800 hover:text-danger-500", title: "Remove", children: "\u00D7" })] }));
}
/* ---------------------------------------------------------------------- */
/* Type-specific groups                                                   */
/* ---------------------------------------------------------------------- */
function RectFields({ layer, patch, }) {
    return (_jsxs(FieldGroup, { title: "Rectangle", children: [_jsx(Field, { label: "Fill", children: _jsx(ColorInput, { value: layer.fill, onChange: (v) => patch({ fill: v }) }) }), _jsx(Field, { label: "Stroke", children: _jsx(ColorInput, { value: layer.stroke ?? "#000000", onChange: (v) => patch({ stroke: v }) }) }), _jsxs(Row, { children: [_jsx(Field, { label: "Stroke W", children: _jsx(NumberInput, { value: layer.strokeWidth, min: 0, onChange: (v) => patch({ strokeWidth: Math.max(0, v) }) }) }), _jsx(Field, { label: "Corner R", children: _jsx(NumberInput, { value: layer.cornerRadius, min: 0, onChange: (v) => patch({ cornerRadius: Math.max(0, v) }) }) })] })] }));
}
function TextFields({ layer, patch, }) {
    return (_jsxs(FieldGroup, { title: "Text", children: [_jsx(Field, { label: "Content", children: _jsx(TextArea, { value: layer.text, onChange: (v) => patch({ text: v }) }) }), _jsx(Field, { label: "Font family", children: _jsx(TextInput, { value: layer.fontFamily, onChange: (v) => patch({ fontFamily: v }) }) }), _jsxs(Row, { children: [_jsx(Field, { label: "Size", children: _jsx(NumberInput, { value: layer.fontSize, min: 1, onChange: (v) => patch({ fontSize: Math.max(1, v) }) }) }), _jsx(Field, { label: "Style", children: _jsx(Select, { value: layer.fontStyle, options: ["normal", "italic", "bold", "bold italic"], onChange: (v) => patch({ fontStyle: v }) }) })] }), _jsxs(Row, { children: [_jsx(Field, { label: "Align", children: _jsx(Select, { value: layer.align, options: ["left", "center", "right"], onChange: (v) => patch({ align: v }) }) }), _jsx(Field, { label: "V-align", children: _jsx(Select, { value: layer.verticalAlign, options: ["top", "middle", "bottom"], onChange: (v) => patch({ verticalAlign: v }) }) })] }), _jsxs(Row, { children: [_jsx(Field, { label: "Color", children: _jsx(ColorInput, { value: layer.fill, onChange: (v) => patch({ fill: v }) }) }), _jsx(Toggle, { label: "Wrap", checked: layer.wrap, onChange: (v) => patch({ wrap: v }) })] }), _jsx(TextPathFields, { layer: layer, patch: patch })] }));
}
/**
 * Text-along-path controls (sec-19 stretch).
 *
 * When `pathData` is set, both renderers flow the text along the
 * supplied SVG path instead of drawing it horizontally. The user can
 * either type / paste an SVG `d` string or pick from a small set of
 * presets calibrated to the layer's bounds (so an arc preset fills the
 * width of the layer regardless of how big it is).
 *
 * Toggle off (clear path) ⇒ falls back to the regular text renderer.
 */
function TextPathFields({ layer, patch, }) {
    const enabled = !!layer.pathData;
    const w = Math.max(1, Math.round(layer.bounds.width));
    const h = Math.max(1, Math.round(layer.bounds.height));
    const presets = [
        {
            label: "Arc up",
            // Quadratic upward curve from left-baseline to right-baseline,
            // peaking at the top of the layer.
            build: () => `M 0 ${h} Q ${w / 2} 0 ${w} ${h}`,
        },
        {
            label: "Arc down",
            build: () => `M 0 0 Q ${w / 2} ${h} ${w} 0`,
        },
        {
            label: "Wave",
            build: () => `M 0 ${h / 2} Q ${w / 4} 0 ${w / 2} ${h / 2} T ${w} ${h / 2}`,
        },
        {
            label: "Circle",
            // SVG arc trick: a 360° arc requires two semicircles because a
            // single rx,ry,_,_,sweep,_ arc with start==end paints nothing.
            // Two halves with the same radius traces a full circle clockwise.
            build: () => {
                const r = Math.min(w, h) / 2 - 2;
                const cx = w / 2;
                const cy = h / 2;
                return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
            },
        },
        {
            label: "Diagonal",
            build: () => `M 0 ${h} L ${w} 0`,
        },
    ];
    return (_jsxs("div", { className: "mt-2 rounded border border-ink-700 bg-ink-900/40 p-3", children: [_jsxs("label", { className: "flex items-center gap-2 text-xs text-ink-100", children: [_jsx("input", { type: "checkbox", checked: enabled, onChange: (e) => {
                            if (!e.target.checked) {
                                patch({ pathData: null });
                            }
                            else {
                                // Default to the Arc-up preset so toggling on yields a
                                // visible curve immediately rather than silently failing.
                                patch({ pathData: presets[0].build() });
                            }
                        }, className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { children: "Flow along path" })] }), _jsx("p", { className: "mt-1 text-[11px] text-ink-500", children: "Sigil text, oath captions, level bars \u2014 text follows an SVG path inside the layer bounds." }), enabled && (_jsxs("div", { className: "mt-3 space-y-2", children: [_jsx(Field, { label: "Path data", hint: "SVG `d` string in layer-local coords.", children: _jsx(TextArea, { value: layer.pathData ?? "", onChange: (v) => patch({ pathData: v.trim() === "" ? null : v }) }) }), _jsxs(Row, { children: [_jsx(Field, { label: "Side", children: _jsx(Select, { value: layer.pathSide ?? "left", options: ["left", "right"], onChange: (v) => patch({ pathSide: v }) }) }), _jsx(Field, { label: "Start %", hint: "Offset along path; 0\u2013100.", children: _jsx(NumberInput, { value: layer.pathStartOffset ?? 0, onChange: (v) => patch({
                                        pathStartOffset: Math.max(0, Math.min(100, v)),
                                    }) }) })] }), _jsx("div", { className: "flex flex-wrap gap-1", children: presets.map((p) => (_jsx("button", { type: "button", onClick: () => patch({ pathData: p.build() }), className: "rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-300 hover:bg-ink-800", children: p.label }, p.label))) }), _jsxs("p", { className: "text-[10px] text-ink-500", children: ["Presets recompute against the current layer size (", _jsxs("span", { className: "text-ink-300", children: [w, " \u00D7 ", h] }), ") \u2014 resize the layer first, then click a preset to refit."] })] }))] }));
}
function ImageFields({ layer, patch, }) {
    // The picker writes both `assetId` and `src` (a fully-qualified blob URL),
    // so the canvas can render whichever happens to be there. When the user
    // clears the asset, both clear together — no half-bound state.
    //
    // If the picked asset carries 9-slice metadata, auto-apply it to the layer
    // so frame assets "just work" — the user can override or clear later.
    const picker = useAssetPicker((asset) => {
        // Cache the freshly-picked asset so the AssetSizingFields section
        // doesn't have to re-fetch a moment later.
        _assetMetaCache.set(asset.id, asset);
        const metaSlice = asset.metadataJson?.slice;
        const slicePatch = metaSlice && typeof metaSlice === "object"
            ? {
                slice: {
                    top: Number(metaSlice.top) || 0,
                    right: Number(metaSlice.right) || 0,
                    bottom: Number(metaSlice.bottom) || 0,
                    left: Number(metaSlice.left) || 0,
                },
            }
            : {};
        patch({
            assetId: asset.id,
            src: assetBlobUrl(asset.id),
            ...slicePatch,
        });
    });
    return (_jsxs(FieldGroup, { title: "Image", children: [_jsx(Field, { label: "Asset", hint: "Stored in the project's asset library.", children: _jsxs("div", { className: "space-y-2", children: [layer.assetId ? (_jsxs("div", { className: "flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 p-2", children: [_jsx("div", { className: "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] [background-size:8px_8px]", children: _jsx("img", { src: assetBlobUrl(layer.assetId), alt: "", className: "max-h-full max-w-full object-contain" }) }), _jsx("div", { className: "min-w-0 flex-1", children: _jsx("p", { className: "truncate font-mono text-[10px] text-ink-300", children: layer.assetId }) }), _jsx("button", { type: "button", onClick: () => patch({ assetId: null, src: null }), className: "rounded border border-transparent px-1.5 py-0.5 text-[10px] text-ink-300 hover:border-ink-600 hover:bg-ink-800", title: "Detach asset", children: "Detach" })] })) : (_jsx("p", { className: "text-[11px] text-ink-500", children: "No asset bound." })), _jsx("button", { type: "button", onClick: picker.open, className: "inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-ink-100 hover:bg-ink-700", children: layer.assetId ? "Change asset…" : "Pick asset…" }), picker.element] }) }), _jsx(Field, { label: "External URL", hint: "Use to point at images outside the asset library.", children: _jsx(TextInput, { value: layer.assetId ? "" : layer.src ?? "", placeholder: layer.assetId ? "(using asset)" : "https://…", onChange: (v) => patch({
                        src: v.trim() === "" ? null : v,
                        assetId: null, // pasting a URL detaches the asset to keep state coherent
                    }) }) }), _jsx(Field, { label: "Fit", hint: layer.slice ? "(ignored — 9-slice in use)" : undefined, children: _jsx(Select, { value: layer.fit, options: ["contain", "cover", "fill", "repeat"], onChange: (v) => patch({ fit: v }) }) }), _jsx(ImageOffsetFields, { layer: layer, patch: patch }), _jsx(ImageCropFields, { layer: layer, patch: patch }), layer.fit === "repeat" && _jsx(ImageTileScaleFields, { layer: layer, patch: patch }), _jsx(AssetSizingFields, { layer: layer, patch: patch }), _jsx(NineSliceFields, { layer: layer, patch: patch })] }));
}
/**
 * Asset sizing helpers — pixels-per-unit consumers.
 *
 * When the bound asset has PPU configured (sec 20.x metadata), the user
 * can:
 *   • see the asset's natural size in source pixels and in logical units
 *   • snap the layer's bounds to the natural source size (1:1 pixel)
 *   • snap the layer's bounds to the nearest multiple of PPU
 *   • size by an integer unit count (e.g. "this layer is 4 × 6 units")
 *
 * The asset metadata is fetched lazily when this section mounts with an
 * assetId. Cached in a module-scoped Map so a card with multiple image
 * layers doesn't trigger N requests.
 */
function AssetSizingFields({ layer, patch, }) {
    const meta = useAssetMeta(layer.assetId);
    if (!layer.assetId)
        return null;
    const ppu = meta?.metadataJson?.pixelsPerUnit;
    const naturalW = meta?.width ?? null;
    const naturalH = meta?.height ?? null;
    const setBounds = (w, h) => {
        patch({
            bounds: { ...layer.bounds, width: Math.round(w), height: Math.round(h) },
        });
    };
    const widthInUnits = ppu && ppu > 0 ? layer.bounds.width / ppu : null;
    const heightInUnits = ppu && ppu > 0 ? layer.bounds.height / ppu : null;
    return (_jsx(Field, { label: "Asset sizing", hint: "Sized off the bound asset's metadata.", children: _jsx("div", { className: "space-y-2 rounded border border-ink-700 bg-ink-900/40 p-2", children: meta === null ? (_jsx("p", { className: "text-[11px] text-ink-500", children: "Loading asset\u2026" })) : meta === undefined ? (_jsx("p", { className: "text-[11px] text-ink-500", children: "Asset not found." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-2 gap-2 font-mono text-[10px] text-ink-400", children: [_jsxs("span", { children: ["Source:", " ", _jsx("span", { className: "text-ink-200", children: naturalW && naturalH ? `${naturalW} × ${naturalH} px` : "—" })] }), _jsxs("span", { children: ["PPU:", " ", _jsx("span", { className: "text-ink-200", children: ppu && ppu > 0 ? ppu : "unset" })] })] }), ppu && ppu > 0 && widthInUnits !== null && heightInUnits !== null && (_jsxs("p", { className: "font-mono text-[10px] text-ink-400", children: ["Layer in units:", " ", _jsxs("span", { className: "text-ink-200", children: [widthInUnits.toFixed(2), " \u00D7 ", heightInUnits.toFixed(2), " u"] })] })), _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [naturalW != null && naturalH != null && (_jsx("button", { type: "button", title: "Resize the layer to the asset's natural pixel size.", onClick: () => setBounds(naturalW, naturalH), className: "rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700", children: "Natural size" })), ppu && ppu > 0 && (_jsx("button", { type: "button", title: "Round width / height to nearest multiple of PPU.", onClick: () => {
                                    const w = Math.max(ppu, Math.round(layer.bounds.width / ppu) * ppu);
                                    const h = Math.max(ppu, Math.round(layer.bounds.height / ppu) * ppu);
                                    setBounds(w, h);
                                }, className: "rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700", children: "Snap to PPU" })), ppu && ppu > 0 && naturalW != null && naturalH != null && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", title: "Resize layer to 2\u00D7 the natural unit count.", onClick: () => setBounds(naturalW * 2, naturalH * 2), className: "rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700", children: "2\u00D7" }), _jsx("button", { type: "button", title: "Resize layer to 4\u00D7 the natural unit count.", onClick: () => setBounds(naturalW * 4, naturalH * 4), className: "rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700", children: "4\u00D7" })] }))] }), (ppu == null || ppu <= 0) && (_jsx("p", { className: "text-[10px] text-ink-500", children: "Set Pixels Per Unit on the asset (Assets view \u2192 Edit) to enable PPU snapping." }))] })) }) }));
}
/**
 * Project-scoped asset metadata cache. The hook returns:
 *   • `null`   — fetching in progress
 *   • `undefined` — asset not found / load failed
 *   • Asset    — fresh metadata from the API
 *
 * The cache is keyed by assetId. We invalidate when the assetId changes
 * (i.e. the user re-picks). Stale data after an external edit is
 * acceptable — the user can detach + re-pick to refresh, and the asset
 * editor's own save flow stays authoritative for the source of truth.
 */
const _assetMetaCache = new Map();
function useAssetMeta(assetId) {
    const [data, setData] = useState(null);
    useEffect(() => {
        if (!assetId) {
            setData(undefined);
            return;
        }
        const cached = _assetMetaCache.get(assetId);
        if (cached) {
            setData(cached);
            return;
        }
        let cancelled = false;
        setData(null);
        void apiGetAsset(assetId)
            .then((asset) => {
            if (cancelled)
                return;
            _assetMetaCache.set(assetId, asset);
            setData(asset);
        })
            .catch(() => {
            if (cancelled)
                return;
            setData(undefined);
        });
        return () => {
            cancelled = true;
        };
    }, [assetId]);
    return data;
}
/**
 * Pan offset in destination pixels — applied AFTER fit. Positive X moves
 * the image right, positive Y moves it down. Useful for nudging "cover"-
 * fitted art so the focal point lands where the user wants without having
 * to re-crop the source.
 */
function ImageOffsetFields({ layer, patch, }) {
    const ox = layer.offset?.x ?? 0;
    const oy = layer.offset?.y ?? 0;
    const set = (next) => {
        const merged = { x: ox, y: oy, ...next };
        // Treat 0,0 as "unset" so the JSON stays clean — the renderer
        // already defaults missing offsets to zero.
        if (merged.x === 0 && merged.y === 0) {
            patch({ offset: undefined });
        }
        else {
            patch({ offset: merged });
        }
    };
    return (_jsx(Field, { label: "Offset (px)", hint: "Pan the image inside its bounds.", children: _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(NumberInputLabeled, { label: "X", value: ox, onChange: (v) => set({ x: v }) }), _jsx(NumberInputLabeled, { label: "Y", value: oy, onChange: (v) => set({ y: v }) })] }) }));
}
/**
 * Source-image crop rectangle. Toggling on starts with a sensible default
 * (left/top = 0, width/height = the asset's natural dimensions if known,
 * else 1024×1024 — the renderer clamps anyway). Toggling off removes the
 * crop entirely so the layer goes back to using the full image.
 */
function ImageCropFields({ layer, patch, }) {
    const enabled = layer.crop != null;
    const c = layer.crop ?? { x: 0, y: 0, width: 256, height: 256 };
    const setCrop = (next) => {
        patch({ crop: { ...c, ...next } });
    };
    return (_jsx(Field, { label: "Source crop", hint: "Use only a region of the source image (e.g. a sprite cell).", children: _jsxs("div", { className: "space-y-2", children: [_jsxs("label", { className: "flex items-center gap-2 text-xs text-ink-100", children: [_jsx("input", { type: "checkbox", checked: enabled, onChange: (e) => {
                                if (!e.target.checked) {
                                    patch({ crop: null });
                                }
                                else {
                                    patch({ crop: c });
                                }
                            }, className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { children: enabled ? "Cropping" : "Use full image" })] }), enabled && (_jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(NumberInputLabeled, { label: "X", value: c.x, onChange: (v) => setCrop({ x: v }) }), _jsx(NumberInputLabeled, { label: "Y", value: c.y, onChange: (v) => setCrop({ y: v }) }), _jsx(NumberInputLabeled, { label: "W", value: c.width, onChange: (v) => setCrop({ width: Math.max(1, v) }) }), _jsx(NumberInputLabeled, { label: "H", value: c.height, onChange: (v) => setCrop({ height: Math.max(1, v) }) })] }))] }) }));
}
/**
 * Tile size multiplier when fit === "repeat". 1 = natural source size;
 * smaller → smaller (denser) tiles; larger → bigger tiles.
 */
function ImageTileScaleFields({ layer, patch, }) {
    const sx = layer.tileScale?.x ?? 1;
    const sy = layer.tileScale?.y ?? 1;
    const set = (next) => {
        const merged = { x: sx, y: sy, ...next };
        patch({ tileScale: merged });
    };
    return (_jsx(Field, { label: "Tile scale", hint: "Multiplier on tile size; 1 = natural.", children: _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(NumberInputLabeled, { label: "X", step: 0.1, value: sx, onChange: (v) => set({ x: Math.max(0.05, v) }) }), _jsx(NumberInputLabeled, { label: "Y", step: 0.1, value: sy, onChange: (v) => set({ y: Math.max(0.05, v) }) })] }) }));
}
/**
 * Compact labelled number input — used by the offset / crop / tile-scale
 * sections so each pair of X/Y inputs share the same look without two
 * <Field>s competing for one row.
 */
function NumberInputLabeled({ label, value, step, onChange, }) {
    return (_jsxs("label", { className: "flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900 pl-2", children: [_jsx("span", { className: "text-[10px] uppercase tracking-wider text-ink-400", children: label }), _jsx("input", { type: "number", step: step ?? 1, value: Number.isFinite(value) ? value : 0, onChange: (e) => {
                    const v = e.target.value;
                    if (v === "")
                        return;
                    const n = Number(v);
                    if (Number.isFinite(n))
                        onChange(step ? n : Math.round(n));
                }, className: "block w-full rounded-r border-l border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" })] }));
}
function NineSliceFields({ layer, patch, }) {
    const slice = layer.slice ?? null;
    const enabled = !!slice;
    function setSlice(next) {
        patch({ slice: next });
    }
    function setInset(key, value) {
        if (!slice)
            return;
        setSlice({ ...slice, [key]: Math.max(0, Math.round(value)) });
    }
    return (_jsxs("div", { className: "rounded border border-ink-700 bg-ink-900/40 p-2", children: [_jsx(Toggle, { label: "9-slice", checked: enabled, onChange: (v) => setSlice(v ? { top: 24, right: 24, bottom: 24, left: 24 } : null) }), enabled && slice && (_jsxs(_Fragment, { children: [_jsxs("p", { className: "mt-1.5 text-[10px] text-ink-500", children: ["Insets are in ", _jsx("em", { children: "source-image" }), " px. Corners stay at their original size; edges and center stretch."] }), _jsxs("div", { className: "mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2", children: [_jsx(NineSlicePreview, { slice: slice }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx(Field, { label: "Top", children: _jsx(NumberInput, { value: slice.top, min: 0, onChange: (v) => setInset("top", v) }) }), _jsx(Field, { label: "Right", children: _jsx(NumberInput, { value: slice.right, min: 0, onChange: (v) => setInset("right", v) }) }), _jsx(Field, { label: "Bottom", children: _jsx(NumberInput, { value: slice.bottom, min: 0, onChange: (v) => setInset("bottom", v) }) }), _jsx(Field, { label: "Left", children: _jsx(NumberInput, { value: slice.left, min: 0, onChange: (v) => setInset("left", v) }) })] })] })] }))] }));
}
/** Tiny visual indicator showing the four slice lines on a card-shaped frame. */
function NineSlicePreview({ slice }) {
    // The preview is purely indicative — it shows where the cuts land in
    // proportion to the maximum inset (capped at 50% of the box).
    const W = 64;
    const H = 64;
    const cap = 30; // cap insets to keep the preview readable
    const t = Math.min(cap, slice.top);
    const r = Math.min(cap, slice.right);
    const b = Math.min(cap, slice.bottom);
    const l = Math.min(cap, slice.left);
    return (_jsxs("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, className: "shrink-0 rounded border border-ink-700 bg-ink-900", "aria-hidden": "true", children: [_jsx("rect", { x: "2", y: "2", width: W - 4, height: H - 4, fill: "none", stroke: "#3a4258", strokeWidth: "1" }), _jsx("line", { x1: 2, x2: W - 2, y1: 2 + t, y2: 2 + t, stroke: "#d4a24c", strokeWidth: "1", strokeDasharray: "2 1" }), _jsx("line", { x1: 2, x2: W - 2, y1: H - 2 - b, y2: H - 2 - b, stroke: "#d4a24c", strokeWidth: "1", strokeDasharray: "2 1" }), _jsx("line", { x1: 2 + l, x2: 2 + l, y1: 2, y2: H - 2, stroke: "#d4a24c", strokeWidth: "1", strokeDasharray: "2 1" }), _jsx("line", { x1: W - 2 - r, x2: W - 2 - r, y1: 2, y2: H - 2, stroke: "#d4a24c", strokeWidth: "1", strokeDasharray: "2 1" }), _jsx("rect", { x: "2", y: "2", width: l, height: t, fill: "rgba(212,162,76,0.18)" }), _jsx("rect", { x: W - 2 - r, y: "2", width: r, height: t, fill: "rgba(212,162,76,0.18)" }), _jsx("rect", { x: "2", y: H - 2 - b, width: l, height: b, fill: "rgba(212,162,76,0.18)" }), _jsx("rect", { x: W - 2 - r, y: H - 2 - b, width: r, height: b, fill: "rgba(212,162,76,0.18)" })] }));
}
function ZoneFields({ layer, patch, }) {
    return (_jsxs(FieldGroup, { title: "Zone (data-bound)", children: [_jsx(Field, { label: "Field key", hint: "Schema field this zone binds to (e.g. name, cost, rules_text).", children: _jsx(TextInput, { value: layer.fieldKey, onChange: (v) => patch({ fieldKey: v.replace(/\s+/g, "_") }) }) }), _jsx(Field, { label: "Binding", children: _jsx(Select, { value: layer.binding, options: ["text", "richText", "number", "image", "icon", "stat"], onChange: (v) => patch({ binding: v }) }) }), _jsx(Field, { label: "Placeholder", children: _jsx(TextInput, { value: layer.placeholder, onChange: (v) => patch({ placeholder: v }) }) }), _jsx(Field, { label: "Font family", children: _jsx(TextInput, { value: layer.fontFamily, onChange: (v) => patch({ fontFamily: v }) }) }), _jsxs(Row, { children: [_jsx(Field, { label: "Size", children: _jsx(NumberInput, { value: layer.fontSize, min: 1, onChange: (v) => patch({ fontSize: Math.max(1, v) }) }) }), _jsx(Field, { label: "Align", children: _jsx(Select, { value: layer.align, options: ["left", "center", "right"], onChange: (v) => patch({ align: v }) }) })] }), _jsx(Field, { label: "Color", children: _jsx(ColorInput, { value: layer.fill, onChange: (v) => patch({ fill: v }) }) })] }));
}
/* ---------------------------------------------------------------------- */
/* Primitives                                                             */
/* ---------------------------------------------------------------------- */
function PanelHeader({ title, subtitle }) {
    return (_jsxs("div", { className: "flex items-baseline justify-between border-b border-ink-700 px-3 py-2", children: [_jsx("h2", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: title }), subtitle && (_jsx("span", { className: "text-[10px] uppercase tracking-wider text-accent-300", children: subtitle }))] }));
}
function FieldGroup({ title, children }) {
    return (_jsxs("fieldset", { className: "space-y-2 rounded border border-ink-700 bg-ink-800/40 p-2", children: [_jsx("legend", { className: "px-1 text-[10px] uppercase tracking-wider text-ink-400", children: title }), children] }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function Row({ children }) {
    return _jsx("div", { className: "grid grid-cols-2 gap-2", children: children });
}
function TextInput({ value, onChange, placeholder, }) {
    return (_jsx("input", { type: "text", value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function TextArea({ value, onChange, }) {
    return (_jsx("textarea", { value: value, rows: 3, onChange: (e) => onChange(e.target.value), className: "block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function NumberInput({ value, onChange, min, max, step, }) {
    return (_jsx("input", { type: "number", value: Number.isFinite(value) ? value : 0, min: min, max: max, step: step ?? 1, onChange: (e) => {
            const v = e.target.value;
            if (v === "")
                return; // ignore mid-edit empty value
            const n = Number(v);
            if (!Number.isNaN(n))
                onChange(n);
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }));
}
function ColorInput({ value, onChange, }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: normalizeHex(value), onChange: (e) => onChange(e.target.value), className: "h-7 w-9 cursor-pointer rounded border border-ink-700 bg-ink-900 p-0.5" }), _jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), className: "block flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" })] }));
}
function Select({ value, options, onChange, }) {
    return (_jsx("select", { value: value, onChange: (e) => onChange(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40", children: options.map((o) => (_jsx("option", { value: o, children: o }, o))) }));
}
function Toggle({ label, checked, onChange, }) {
    return (_jsxs("label", { className: "flex items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked), className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { children: label })] }));
}
function ReadOnly({ value }) {
    return (_jsx("div", { className: "block w-full select-text rounded border border-ink-700 bg-ink-900/60 px-2 py-1 font-mono text-xs text-ink-300", children: value }));
}
/** Coerce common color strings into a `#rrggbb` hex that <input type=color> accepts. */
function normalizeHex(input) {
    if (/^#[0-9a-fA-F]{6}$/.test(input))
        return input;
    if (/^#[0-9a-fA-F]{3}$/.test(input)) {
        const [, r, g, b] = input.match(/#(.)(.)(.)/) ?? [];
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    // Anything else (rgba, hsl, named) — fall back to black so the picker has a value.
    return "#000000";
}
