import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
const RESERVED_KEYS = new Set([
    "name",
    "slug",
    "rarity",
    "collector_number",
    "collectorNumber",
    "status",
]);
function autoSlug(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
}
function parseRow(raw, rowIndex) {
    const name = typeof raw.name === "string"
        ? raw.name.trim()
        : raw.name !== undefined && raw.name !== null
            ? String(raw.name)
            : "";
    const data = {};
    for (const [k, v] of Object.entries(raw)) {
        if (RESERVED_KEYS.has(k))
            continue;
        if (v === "" || v === null || v === undefined)
            continue;
        data[k] = v;
    }
    const collectorRaw = raw.collectorNumber ?? raw.collector_number ?? raw.collector ?? null;
    const collectorNumber = collectorRaw !== null &&
        collectorRaw !== undefined &&
        !Number.isNaN(Number(collectorRaw))
        ? Math.max(0, Math.floor(Number(collectorRaw)))
        : undefined;
    const slug = typeof raw.slug === "string" && raw.slug.trim()
        ? autoSlug(raw.slug)
        : autoSlug(name) || `row-${rowIndex + 1}`;
    return {
        rowIndex,
        raw,
        mapped: {
            name,
            slug,
            rarity: typeof raw.rarity === "string" ? raw.rarity : undefined,
            collectorNumber,
            status: typeof raw.status === "string" ? raw.status : undefined,
        },
        data,
        ok: name.length > 0,
        error: name.length === 0 ? "missing 'name'" : undefined,
    };
}
async function readFile(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".json")) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.cards)
                ? parsed.cards
                : (() => {
                    throw new Error("JSON must be an array or have a top-level 'cards' array.");
                })();
        return list.map((row, i) => {
            if (typeof row !== "object" || row === null) {
                return {
                    rowIndex: i,
                    raw: {},
                    mapped: { name: "", slug: "" },
                    data: {},
                    ok: false,
                    error: "row is not an object",
                };
            }
            return parseRow(row, i);
        });
    }
    // xlsx + xls + csv all go through SheetJS.
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
        throw new Error("Workbook has no sheets.");
    const sheet = workbook.Sheets[sheetName];
    // defval: "" so empty cells become "" rather than undefined; keeps row shapes consistent.
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return json.map((row, i) => parseRow(row, i));
}
export function CardImporter({ open, onClose, onDone, }) {
    const projectId = useDesigner((s) => s.activeProjectId);
    const cardTypeId = useDesigner((s) => s.activeCardTypeId);
    const [rows, setRows] = useState([]);
    const [filename, setFilename] = useState(null);
    const [parseError, setParseError] = useState(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
    function reset() {
        setRows([]);
        setFilename(null);
        setParseError(null);
        setProgress({ done: 0, total: 0, failed: 0 });
    }
    async function handleFile(file) {
        reset();
        if (!file)
            return;
        setFilename(file.name);
        try {
            const parsed = await readFile(file);
            setRows(parsed);
        }
        catch (err) {
            setParseError(err instanceof Error ? err.message : "parse failed");
        }
    }
    async function commit() {
        if (!projectId || !cardTypeId) {
            setParseError("Pick a project + card type before importing.");
            return;
        }
        const valid = rows.filter((r) => r.ok);
        setImporting(true);
        setProgress({ done: 0, total: valid.length, failed: 0 });
        try {
            // Sequential keeps slugs unique-deterministic and gives deterministic
            // progress. Parallel would speed it up but make error attribution
            // harder. Revisit when files cross 500 rows.
            for (const row of valid) {
                try {
                    await api.createCard({
                        projectId,
                        cardTypeId,
                        name: row.mapped.name,
                        slug: row.mapped.slug,
                        dataJson: row.data,
                    });
                    setProgress((p) => ({ ...p, done: p.done + 1 }));
                }
                catch {
                    setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
                }
            }
            // Refresh card list in the store from the server.
            const cards = await api.listCards({ projectId, cardTypeId });
            useDesigner.setState({ cards });
            onDone();
            reset();
            onClose();
        }
        finally {
            setImporting(false);
        }
    }
    if (!open)
        return null;
    const validCount = rows.filter((r) => r.ok).length;
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": "Import cards", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !importing)
                onClose();
        }, children: _jsxs("div", { className: "flex h-[80vh] w-[min(960px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-center justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-50", children: "Import cards" }), _jsx("p", { className: "text-[11px] text-ink-400", children: "From .xlsx \u00B7 .xls \u00B7 .csv \u00B7 .json \u2014 first sheet / top-level array. Each row becomes a card." })] }), _jsx("button", { type: "button", onClick: onClose, disabled: importing, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsx(FilePicker, { onFile: handleFile, disabled: importing, filename: filename }), parseError && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: parseError })), _jsx("div", { className: "flex-1 overflow-hidden", children: rows.length === 0 && !parseError ? (_jsx(EmptyState, { filename: filename })) : (_jsx(ImportPreview, { rows: rows })) }), _jsxs("footer", { className: "flex items-center justify-between gap-3 border-t border-ink-700 px-4 py-3", children: [_jsx("div", { className: "text-[11px] text-ink-400", children: rows.length === 0 ? ("No file loaded yet.") : importing ? (_jsxs(_Fragment, { children: ["Importing: ", progress.done, " / ", progress.total, progress.failed > 0 && (_jsxs("span", { className: "ml-2 text-danger-500", children: [progress.failed, " failed"] }))] })) : (_jsxs(_Fragment, { children: [rows.length, " row", rows.length === 1 ? "" : "s", " parsed \u00B7", " ", _jsxs("span", { className: "text-emerald-300", children: [validCount, " valid"] }), rows.length - validCount > 0 && (_jsxs("span", { className: "ml-2 text-amber-300", children: [rows.length - validCount, " skipped"] }))] })) }), _jsxs("div", { className: "flex items-center gap-2", children: [rows.length > 0 && !importing && (_jsx("button", { type: "button", onClick: reset, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700", children: "Clear" })), _jsx("button", { type: "button", onClick: commit, disabled: importing || validCount === 0 || !cardTypeId, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: importing ? "Importing…" : `Import ${validCount} card${validCount === 1 ? "" : "s"}` })] })] })] }) }));
}
function FilePicker({ onFile, disabled, filename, }) {
    const [dragOver, setDragOver] = useState(false);
    return (_jsxs("label", { onDragOver: (e) => {
            if (disabled)
                return;
            e.preventDefault();
            setDragOver(true);
        }, onDragLeave: () => setDragOver(false), onDrop: (e) => {
            e.preventDefault();
            setDragOver(false);
            if (disabled)
                return;
            const f = e.dataTransfer?.files?.[0] ?? null;
            if (f)
                onFile(f);
        }, className: [
            "mx-4 mt-3 flex cursor-pointer items-center justify-center gap-3 rounded border-2 border-dashed py-4 text-xs",
            disabled
                ? "cursor-not-allowed border-ink-700 text-ink-500"
                : dragOver
                    ? "border-accent-500/70 bg-accent-500/10 text-accent-300"
                    : "border-ink-700 text-ink-300 hover:border-ink-600 hover:bg-ink-800/40",
        ].join(" "), children: [_jsx(UploadIcon, {}), _jsx("span", { children: filename ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "font-mono text-ink-200", children: filename }), " \u00B7 click to replace"] })) : (_jsxs(_Fragment, { children: ["Drop a file here, or ", _jsx("u", { children: "click to browse" }), _jsx("span", { className: "ml-1 text-ink-500", children: "(.xlsx, .xls, .csv, .json)" })] })) }), _jsx("input", { type: "file", accept: ".xlsx,.xls,.csv,.json,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv", onChange: (e) => {
                    const f = e.target.files?.[0] ?? null;
                    onFile(f);
                    e.target.value = "";
                }, className: "sr-only" })] }));
}
function EmptyState({ filename }) {
    return (_jsx("div", { className: "flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-ink-500", children: filename ? (_jsxs("p", { children: ["Reading ", filename, "\u2026"] })) : (_jsxs(_Fragment, { children: [_jsx("p", { children: "Pick a file to preview rows here." }), _jsxs("p", { className: "max-w-md text-[11px] text-ink-600", children: ["Recognised columns: ", _jsx("code", { className: "text-ink-400", children: "name" }), ",", " ", _jsx("code", { className: "text-ink-400", children: "slug" }), ",", " ", _jsx("code", { className: "text-ink-400", children: "rarity" }), ",", " ", _jsx("code", { className: "text-ink-400", children: "collector_number" }), ",", " ", _jsx("code", { className: "text-ink-400", children: "status" }), ". Anything else lands in", " ", _jsx("code", { className: "text-ink-400", children: "dataJson" }), "."] })] })) }));
}
function ImportPreview({ rows }) {
    // Build a stable column list across all rows so the table doesn't shift.
    const columnSet = new Set();
    for (const r of rows) {
        Object.keys(r.raw).forEach((k) => columnSet.add(k));
    }
    const columns = Array.from(columnSet);
    const previewRows = rows.slice(0, 200);
    return (_jsxs("div", { className: "h-full overflow-auto", children: [_jsxs("table", { className: "w-full border-collapse text-xs", children: [_jsx("thead", { className: "sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wider text-ink-500", children: _jsxs("tr", { children: [_jsx("th", { className: "border-b border-ink-700 px-2 py-1.5 text-left", children: "#" }), _jsx("th", { className: "border-b border-ink-700 px-2 py-1.5 text-left", children: "Status" }), columns.map((c) => (_jsxs("th", { className: "whitespace-nowrap border-b border-ink-700 px-2 py-1.5 text-left font-mono", children: [c, RESERVED_KEYS.has(c) ? (_jsx("span", { className: "ml-1 rounded bg-accent-500/20 px-1 text-[9px] text-accent-300", children: "field" })) : (_jsx("span", { className: "ml-1 text-ink-600", children: "\u2192 data" }))] }, c)))] }) }), _jsx("tbody", { children: previewRows.map((r) => (_jsxs("tr", { className: "hover:bg-ink-800/40", children: [_jsx("td", { className: "border-b border-ink-800 px-2 py-1 text-[10px] text-ink-500", children: r.rowIndex + 1 }), _jsx("td", { className: "border-b border-ink-800 px-2 py-1", children: r.ok ? (_jsx("span", { className: "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300", children: "ok" })) : (_jsx("span", { className: "rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase text-amber-300", title: r.error, children: "skip" })) }), columns.map((c) => (_jsx("td", { className: "border-b border-ink-800 px-2 py-1 text-ink-200", children: formatCell(r.raw[c]) }, c)))] }, r.rowIndex))) })] }), rows.length > previewRows.length && (_jsxs("p", { className: "px-3 py-2 text-[11px] text-ink-500", children: ["Showing first ", previewRows.length, " of ", rows.length, " rows. All will be imported."] }))] }));
}
function formatCell(v) {
    if (v === null || v === undefined)
        return "";
    if (typeof v === "string")
        return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    return JSON.stringify(v);
}
function UploadIcon() {
    return (_jsx("svg", { className: "h-4 w-4", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 11V3M5 6l3-3 3 3M3 13h10" }) }));
}
