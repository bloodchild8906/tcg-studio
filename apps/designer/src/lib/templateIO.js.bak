/**
 * JSON load/save helpers for templates.
 *
 * We deliberately avoid third-party validators here — Zod / Yup would be
 * overkill for v0. Instead, we do hand-rolled shape checks that produce useful
 * error messages and are easy to keep in sync with `types.ts`.
 *
 * When the backend lands, this file shrinks: the server becomes the source of
 * truth and these helpers exist only for "Import from JSON" / "Export as JSON".
 */
export class TemplateIOError extends Error {
    path;
    constructor(message, path) {
        super(path ? `${message} (at ${path})` : message);
        this.path = path;
        this.name = "TemplateIOError";
    }
}
function assert(cond, msg, path) {
    if (!cond)
        throw new TemplateIOError(msg, path);
}
function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
/**
 * Best-effort runtime validation. Returns a typed `CardTypeTemplate` on success,
 * throws `TemplateIOError` on shape mismatch.
 */
export function parseTemplate(raw) {
    assert(isObject(raw), "template must be an object");
    assert(raw.version === 1, "unsupported template version (expected 1)", "version");
    assert(typeof raw.id === "string", "id must be a string", "id");
    assert(typeof raw.name === "string", "name must be a string", "name");
    assert(typeof raw.description === "string", "description must be a string", "description");
    assert(isObject(raw.size), "size must be an object", "size");
    const size = raw.size;
    assert(typeof size.width === "number", "size.width must be a number", "size.width");
    assert(typeof size.height === "number", "size.height must be a number", "size.height");
    assert(typeof raw.bleed === "number", "bleed must be a number", "bleed");
    assert(typeof raw.safeZone === "number", "safeZone must be a number", "safeZone");
    assert(typeof raw.background === "string", "background must be a string", "background");
    assert(Array.isArray(raw.layers), "layers must be an array", "layers");
    // We do shape checks only on the *common* fields here; type-specific fields
    // get the benefit of TS at compile time but would balloon this validator.
    // The tradeoff: a user editing JSON by hand can still produce garbage that
    // breaks rendering. That's acceptable for v0.
    raw.layers.forEach((layer, i) => {
        const path = `layers[${i}]`;
        assert(isObject(layer), "layer must be an object", path);
        const l = layer;
        assert(typeof l.id === "string", "layer.id must be a string", `${path}.id`);
        assert(typeof l.name === "string", "layer.name must be a string", `${path}.name`);
        assert(l.type === "rect" || l.type === "text" || l.type === "image" || l.type === "zone", "layer.type must be one of rect|text|image|zone", `${path}.type`);
        assert(isObject(l.bounds), "layer.bounds must be an object", `${path}.bounds`);
        assert(typeof l.rotation === "number", "layer.rotation must be a number", `${path}.rotation`);
        assert(typeof l.visible === "boolean", "layer.visible must be a boolean", `${path}.visible`);
        assert(typeof l.locked === "boolean", "layer.locked must be a boolean", `${path}.locked`);
        assert(typeof l.opacity === "number", "layer.opacity must be a number", `${path}.opacity`);
    });
    return raw;
}
/** Pretty-print a template for download. */
export function serializeTemplate(template) {
    return JSON.stringify(template, null, 2);
}
/**
 * Trigger a browser download of `template` as JSON. Filename is derived from
 * the template id, sanitized for filesystem safety.
 */
export function downloadTemplate(template) {
    const safe = template.id.replace(/[^a-z0-9_-]+/gi, "_");
    const blob = new Blob([serializeTemplate(template)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.tcgstudio.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
/** Open a file picker and resolve with the parsed template. */
export function pickTemplateFile() {
    return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                reject(new TemplateIOError("no file selected"));
                return;
            }
            try {
                const text = await file.text();
                resolve(parseTemplate(JSON.parse(text)));
            }
            catch (err) {
                reject(err instanceof TemplateIOError
                    ? err
                    : new TemplateIOError(`failed to parse JSON: ${err.message ?? String(err)}`));
            }
        };
        input.click();
    });
}
