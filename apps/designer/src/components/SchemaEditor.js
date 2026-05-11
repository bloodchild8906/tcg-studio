import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { selectActiveCardType, useDesigner } from "@/store/designerStore";
const FIELD_TYPES = [
    "text",
    "longText",
    "richText",
    "number",
    "boolean",
    "stat",
    "image",
];
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
function parseSchema(json) {
    if (typeof json !== "object" || json === null)
        return [];
    const fieldsRaw = json.fields;
    if (!Array.isArray(fieldsRaw))
        return [];
    const out = [];
    for (const raw of fieldsRaw) {
        if (typeof raw !== "object" || raw === null)
            continue;
        const r = raw;
        if (typeof r.key !== "string" || !r.key)
            continue;
        const typeStr = typeof r.type === "string" ? r.type : "text";
        out.push({
            key: r.key,
            type: FIELD_TYPES.includes(typeStr) ? typeStr : "text",
            required: typeof r.required === "boolean" ? r.required : false,
            min: typeof r.min === "number" ? r.min : null,
            max: typeof r.max === "number" ? r.max : null,
        });
    }
    return out;
}
function serialize(fields) {
    return {
        fields: fields.map((f) => {
            const out = {
                key: f.key,
                type: f.type,
                required: f.required,
            };
            if (f.type === "number") {
                if (f.min !== null && f.min !== undefined)
                    out.min = f.min;
                if (f.max !== null && f.max !== undefined)
                    out.max = f.max;
            }
            return out;
        }),
    };
}
function validate(fields) {
    const seen = new Set();
    for (const [i, f] of fields.entries()) {
        if (!f.key.trim())
            return `Field ${i + 1}: key cannot be empty.`;
        if (!FIELD_KEY_PATTERN.test(f.key)) {
            return `Field ${i + 1}: key "${f.key}" must be lowercase + underscores (a-z, 0-9, _) and start with a letter.`;
        }
        if (seen.has(f.key))
            return `Duplicate key "${f.key}".`;
        seen.add(f.key);
    }
    return null;
}
export function SchemaEditor({ open, onClose, }) {
    const cardType = useDesigner(selectActiveCardType);
    const updateSchema = useDesigner((s) => s.updateActiveCardTypeSchema);
    const [fields, setFields] = useState([]);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    // Reset whenever we open or the card type changes.
    useEffect(() => {
        if (open && cardType) {
            setFields(parseSchema(cardType.schemaJson));
            setError(null);
        }
    }, [open, cardType]);
    if (!open || !cardType)
        return null;
    function setField(i, patch) {
        setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
    }
    function addField() {
        setFields((fs) => {
            // Pick a unique default key — field_1, field_2, …
            const used = new Set(fs.map((f) => f.key));
            let n = fs.length + 1;
            while (used.has(`field_${n}`))
                n++;
            return [...fs, { key: `field_${n}`, type: "text", required: false }];
        });
    }
    function moveField(i, dir) {
        setFields((fs) => {
            const j = i + dir;
            if (j < 0 || j >= fs.length)
                return fs;
            const next = [...fs];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    }
    function removeField(i) {
        setFields((fs) => fs.filter((_, idx) => idx !== i));
    }
    async function save() {
        const v = validate(fields);
        if (v) {
            setError(v);
            return;
        }
        setError(null);
        setSaving(true);
        try {
            await updateSchema(serialize(fields));
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "save failed");
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": "Edit schema", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !saving)
                onClose();
        }, children: _jsxs("div", { className: "flex h-[80vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-start justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsxs("h2", { className: "text-sm font-semibold text-ink-50", children: ["Schema \u00B7 ", _jsx("span", { className: "text-ink-300", children: cardType.name })] }), _jsx("p", { className: "text-[11px] text-ink-400", children: "Define the fields cards of this type will carry. The Cards form renders one input per field; zones in the template can bind to these field keys." })] }), _jsx("button", { type: "button", onClick: onClose, disabled: saving, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-3", children: [fields.length === 0 ? (_jsx(EmptyState, {})) : (_jsxs("ul", { className: "space-y-1.5", children: [_jsx(Header, {}), fields.map((f, i) => (_jsx(FieldRow, { field: f, index: i, total: fields.length, onChange: (patch) => setField(i, patch), onMoveUp: () => moveField(i, -1), onMoveDown: () => moveField(i, 1), onDelete: () => removeField(i) }, i)))] })), _jsx("button", { type: "button", onClick: addField, className: "mt-3 inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-ink-100 hover:bg-ink-700", children: "+ Add field" })] }), error && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: error })), _jsxs("footer", { className: "flex items-center justify-between border-t border-ink-700 px-4 py-3", children: [_jsxs("p", { className: "text-[11px] text-ink-500", children: [fields.length, " field", fields.length === 1 ? "" : "s"] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: onClose, disabled: saving, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "button", onClick: save, disabled: saving, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: saving ? "Saving…" : "Save schema" })] })] })] }) }));
}
function Header() {
    return (_jsxs("li", { className: "grid grid-cols-[1fr_140px_70px_140px_auto] items-center gap-2 px-1 pb-1 text-[10px] uppercase tracking-wider text-ink-500", children: [_jsx("span", { children: "Key" }), _jsx("span", { children: "Type" }), _jsx("span", { className: "text-center", children: "Required" }), _jsx("span", { children: "Min / Max" }), _jsx("span", {})] }));
}
function FieldRow({ field, index, total, onChange, onMoveUp, onMoveDown, onDelete, }) {
    const showRange = field.type === "number";
    return (_jsxs("li", { className: "grid grid-cols-[1fr_140px_70px_140px_auto] items-center gap-2 rounded border border-ink-800 bg-ink-900/40 px-2 py-1.5", children: [_jsx("input", { type: "text", value: field.key, onChange: (e) => onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") }), placeholder: "field_key", className: "rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }), _jsx("select", { value: field.type, onChange: (e) => onChange({ type: e.target.value }), className: "rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: FIELD_TYPES.map((t) => (_jsx("option", { value: t, children: t }, t))) }), _jsx("label", { className: "flex items-center justify-center", children: _jsx("input", { type: "checkbox", checked: field.required, onChange: (e) => onChange({ required: e.target.checked }), className: "accent-accent-500" }) }), _jsxs("div", { className: "grid grid-cols-2 gap-1", children: [_jsx("input", { type: "number", value: field.min ?? "", onChange: (e) => onChange({ min: e.target.value === "" ? null : Number(e.target.value) }), placeholder: "min", disabled: !showRange, className: "rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 disabled:opacity-30" }), _jsx("input", { type: "number", value: field.max ?? "", onChange: (e) => onChange({ max: e.target.value === "" ? null : Number(e.target.value) }), placeholder: "max", disabled: !showRange, className: "rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 disabled:opacity-30" })] }), _jsxs("div", { className: "flex items-center gap-0.5", children: [_jsx(IconButton, { title: "Move up", disabled: index === 0, onClick: onMoveUp, children: _jsx(ArrowUp, {}) }), _jsx(IconButton, { title: "Move down", disabled: index === total - 1, onClick: onMoveDown, children: _jsx(ArrowDown, {}) }), _jsx(IconButton, { title: "Remove", danger: true, onClick: onDelete, children: _jsx(Trash, {}) })] })] }));
}
function EmptyState() {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-2 rounded border border-dashed border-ink-700 px-6 py-10 text-center text-xs text-ink-500", children: [_jsx("p", { children: "No schema fields yet." }), _jsxs("p", { className: "text-[11px] text-ink-600", children: ["Add the first field below \u2014 start with ", _jsx("code", { className: "text-ink-400", children: "name" }), ",", " ", _jsx("code", { className: "text-ink-400", children: "cost" }), ", ", _jsx("code", { className: "text-ink-400", children: "type_line" }), ",", " ", _jsx("code", { className: "text-ink-400", children: "rules_text" }), "."] })] }));
}
function IconButton({ children, onClick, title, disabled, danger, }) {
    return (_jsx("button", { type: "button", title: title, disabled: disabled, onClick: onClick, className: [
            "inline-flex h-6 w-6 items-center justify-center rounded text-ink-300 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30",
            danger && "hover:!bg-danger-500/20 hover:!text-danger-500",
        ]
            .filter(Boolean)
            .join(" "), children: children }));
}
function ArrowUp() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 13V3M4 7l4-4 4 4" }) }));
}
function ArrowDown() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 3v10M4 9l4 4 4-4" }) }));
}
function Trash() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l1 8h4l1-8" }) }));
}
