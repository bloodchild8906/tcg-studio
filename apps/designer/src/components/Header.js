import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { selectActiveCardType, selectActiveProject, useDesigner, } from "@/store/designerStore";
import { downloadTemplate, pickTemplateFile, TemplateIOError, } from "@/lib/templateIO";
import { exportPngBus } from "@/lib/exportPngBus";
import { SchemaEditor } from "@/components/SchemaEditor";
import { assetBlobUrl } from "@/lib/api";
/**
 * Global header.
 *
 * Always visible:
 *   • Brand mark
 *   • Project picker (tenant-wide context)
 *   • Save status badge
 *
 * Visible only in the Designer view (since they only mean something there):
 *   • Undo / redo
 *   • Add layer dropdown
 *   • Save / Export JSON / Import / Export PNG / Reset to sample
 *
 * The card-type picker used to live here too — it now belongs to the section
 * (you pick a card type by clicking a tile, not from a global dropdown), so
 * we show its name as a read-only breadcrumb when the user is in a card-
 * type-scoped section (designer / cards) and skip it otherwise.
 */
export function Header() {
    const view = useDesigner((s) => s.view);
    const tenants = useDesigner((s) => s.tenants);
    const activeTenantSlug = useDesigner((s) => s.activeTenantSlug);
    const selectTenant = useDesigner((s) => s.selectTenant);
    const activeTenant = tenants.find((t) => t.slug === activeTenantSlug) ?? null;
    const branding = activeTenant?.brandingJson ?? {};
    const projects = useDesigner((s) => s.projects);
    const activeProject = useDesigner(selectActiveProject);
    const selectProject = useDesigner((s) => s.selectProject);
    const activeCardType = useDesigner(selectActiveCardType);
    const setView = useDesigner((s) => s.setView);
    const saveStatus = useDesigner((s) => s.saveStatus);
    const serverVersion = useDesigner((s) => s.serverTemplateVersion);
    return (_jsxs("header", { className: "flex h-12 items-center gap-3 bg-ink-900 px-3 text-ink-50", style: typeof branding.accentColor === "string"
            ? {
                ["--brand-accent"]: branding.accentColor,
            }
            : undefined, children: [_jsx(BrandMark, { productName: typeof branding.productName === "string" && branding.productName
                    ? branding.productName
                    : "TCGStudio", hidePlatform: branding.hidePlatformBranding === true, accentColor: typeof branding.accentColor === "string" ? branding.accentColor : null, logoAssetId: typeof branding.logoAssetId === "string" && branding.logoAssetId
                    ? branding.logoAssetId
                    : null }), _jsx(Divider, {}), _jsx(PickerSelect, { label: "Tenant", value: activeTenantSlug, onChange: (slug) => {
                    if (slug)
                        void selectTenant(slug);
                }, options: tenants.map((t) => ({ value: t.slug, label: t.name })), emptyLabel: "(no tenant)" }), _jsx(PickerSelect, { label: "Project", value: activeProject?.id ?? "", onChange: (v) => selectProject(v), options: projects.map((p) => ({ value: p.id, label: p.name })), emptyLabel: "(no project)" }), (view === "designer" || view === "cards") && activeCardType && (_jsxs(_Fragment, { children: [_jsx(Breadcrumb, { separator: true }), _jsx("button", { type: "button", onClick: () => setView("card_types"), className: "rounded px-1.5 py-0.5 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100", title: "Back to card types", children: "Card types" }), _jsx(Breadcrumb, {}), _jsx("span", { className: "text-xs text-ink-200", children: activeCardType.name })] })), _jsx(SaveStatusBadge, { status: saveStatus, version: serverVersion }), view === "designer" && (_jsx(DesignerToolbar, {})), view !== "designer" && _jsx("div", { className: "ml-auto" })] }));
}
function DesignerToolbar() {
    const template = useDesigner((s) => s.template);
    const addLayer = useDesigner((s) => s.addLayer);
    const loadTemplate = useDesigner((s) => s.loadTemplate);
    const resetToSample = useDesigner((s) => s.resetToSample);
    const saveActiveTemplate = useDesigner((s) => s.saveActiveTemplate);
    const undo = useDesigner((s) => s.undo);
    const redo = useDesigner((s) => s.redo);
    const canUndo = useDesigner((s) => s.history.past.length > 0);
    const canRedo = useDesigner((s) => s.history.future.length > 0);
    const saveStatus = useDesigner((s) => s.saveStatus);
    const activeCardTypeId = useDesigner((s) => s.activeCardTypeId);
    const cardType = useDesigner(selectActiveCardType);
    const [schemaOpen, setSchemaOpen] = useState(false);
    // Read field count off the schemaJson without parsing the whole thing.
    const fieldCount = Array.isArray(cardType?.schemaJson?.fields)
        ? (cardType.schemaJson.fields.length)
        : 0;
    async function handleImport() {
        try {
            const next = await pickTemplateFile();
            loadTemplate(next);
        }
        catch (err) {
            if (err instanceof TemplateIOError)
                alert(`Import failed:\n${err.message}`);
            else if (err?.message)
                alert(`Import failed:\n${err.message}`);
        }
    }
    return (_jsxs("div", { className: "ml-auto flex items-center gap-1.5", children: [_jsx(ToolbarButton, { onClick: undo, disabled: !canUndo, title: "Undo (Ctrl/Cmd+Z)", children: _jsx(UndoIcon, {}) }), _jsx(ToolbarButton, { onClick: redo, disabled: !canRedo, title: "Redo (Ctrl/Cmd+Shift+Z)", children: _jsx(RedoIcon, {}) }), _jsx(Divider, {}), _jsx(AddLayerMenu, { onAdd: (t) => addLayer(t) }), _jsxs(ToolbarButton, { onClick: () => setSchemaOpen(true), disabled: !cardType, title: "Edit the field schema for this card type", children: [_jsx(SchemaIcon, {}), "Schema", _jsx("span", { className: "ml-0.5 rounded-full bg-ink-700 px-1.5 text-[9px] text-ink-300", children: fieldCount })] }), _jsx(SchemaEditor, { open: schemaOpen, onClose: () => setSchemaOpen(false) }), _jsx(Divider, {}), _jsxs(PrimaryButton, { onClick: () => saveActiveTemplate(), disabled: !activeCardTypeId || saveStatus === "saving" || saveStatus === "synced", title: "Save the current template back to the server", children: [_jsx(SaveIcon, {}), saveStatus === "saving" ? "Saving…" : "Save"] }), _jsxs(ToolbarButton, { onClick: () => downloadTemplate(template), title: "Download template as JSON", children: [_jsx(DownloadIcon, {}), " JSON"] }), _jsxs(ToolbarButton, { onClick: handleImport, title: "Replace the canvas with a JSON file", children: [_jsx(UploadIcon, {}), " Import"] }), _jsxs(ToolbarButton, { onClick: () => exportPngBus.emit("export"), title: "Export the card art at design size to PNG", children: [_jsx(ExportIcon, {}), " PNG"] }), _jsx(ToolbarButton, { onClick: resetToSample, title: "Replace the canvas with the bundled sample template (unsynced)", children: _jsx(ResetIcon, {}) })] }));
}
/* ---------------------------------------------------------------------- */
/* Brand                                                                  */
/* ---------------------------------------------------------------------- */
function BrandMark({ productName, hidePlatform, accentColor, logoAssetId, }) {
    const safeAccent = isCleanHex(accentColor) ? accentColor : "#d4a24c";
    // Resolution order for the mark, simplest first:
    //   1. Per-tenant uploaded logo asset (if logoAssetId set).
    //   2. Platform default — the editable SVG in /branding/mark.svg.
    // Either way the product-name text sits to the right of the mark.
    const isPlatformBrand = productName === "TCGStudio" || productName === "TcgStudio";
    const markSrc = logoAssetId ? assetBlobUrl(logoAssetId) : "/branding/mark.svg";
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("img", { src: markSrc, alt: "", "aria-hidden": "true", className: "h-7 w-7 rounded shrink-0 object-contain", style: {
                    // Glow tint matching the accent — invisible on the platform mark
                    // but lets a custom monochrome logo absorb the brand color.
                    boxShadow: logoAssetId
                        ? "none"
                        : `0 0 0 1px ${safeAccent}33`,
                    background: "#11141a",
                } }), _jsx("span", { className: "font-semibold tracking-wide text-ink-50", children: productName }), !hidePlatform && (_jsx("span", { className: "hidden rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider sm:inline-block", style: { color: safeAccent }, children: isPlatformBrand ? "Designer" : "by TCGStudio" }))] }));
}
function isCleanHex(value) {
    if (!value)
        return false;
    return /^#[0-9a-fA-F]{6}$/.test(value);
}
function Breadcrumb({ separator }) {
    return (_jsx("span", { className: "text-ink-600", "aria-hidden": "true", children: separator ? "/" : "›" }));
}
/* ---------------------------------------------------------------------- */
/* Project picker                                                         */
/* ---------------------------------------------------------------------- */
function PickerSelect({ label, value, onChange, options, emptyLabel, }) {
    return (_jsxs("label", { className: "flex items-center gap-1.5 text-xs text-ink-300", children: [_jsx("span", { className: "text-[10px] uppercase tracking-wider text-ink-500", children: label }), _jsxs("select", { value: value, disabled: options.length === 0, onChange: (e) => onChange(e.target.value), className: "rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-40", children: [options.length === 0 && _jsx("option", { value: "", children: emptyLabel }), options.map((o) => (_jsx("option", { value: o.value, children: o.label }, o.value)))] })] }));
}
/* ---------------------------------------------------------------------- */
/* Save status badge                                                      */
/* ---------------------------------------------------------------------- */
function SaveStatusBadge({ status, version, }) {
    const lastError = useDesigner((s) => s.lastError);
    const cfg = STATUS_CFG[status];
    return (_jsxs("span", { title: lastError ? `Error: ${lastError}` : cfg.tip, className: [
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
            cfg.classes,
        ].join(" "), children: [_jsx("span", { className: `inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}` }), cfg.label, version !== null && status !== "loading" && status !== "idle" && (_jsxs("span", { className: "text-ink-500 normal-case tracking-normal", children: ["v", version] }))] }));
}
const STATUS_CFG = {
    idle: {
        label: "no template",
        classes: "border-ink-700 bg-ink-800 text-ink-400",
        dot: "bg-ink-500",
        tip: "Pick or create a card type to bind a template.",
    },
    loading: {
        label: "loading",
        classes: "border-sky-500/40 bg-sky-500/10 text-sky-300",
        dot: "bg-sky-400",
        tip: "Fetching from the API…",
    },
    synced: {
        label: "synced",
        classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        dot: "bg-emerald-400",
        tip: "All changes are saved.",
    },
    dirty: {
        label: "unsaved",
        classes: "border-amber-500/50 bg-amber-500/10 text-amber-300",
        dot: "bg-amber-400",
        tip: "You have local changes. Click Save to push.",
    },
    saving: {
        label: "saving",
        classes: "border-sky-500/40 bg-sky-500/10 text-sky-300",
        dot: "bg-sky-400 animate-pulse",
        tip: "Saving…",
    },
    error: {
        label: "error",
        classes: "border-danger-500/60 bg-danger-500/10 text-danger-500",
        dot: "bg-danger-500",
        tip: "Last operation failed — hover for details.",
    },
};
/* ---------------------------------------------------------------------- */
/* Toolbar primitives                                                     */
/* ---------------------------------------------------------------------- */
function Divider() {
    return _jsx("span", { className: "mx-1 h-5 w-px bg-ink-700", "aria-hidden": "true" });
}
function ToolbarButton({ children, onClick, title, disabled, }) {
    return (_jsx("button", { type: "button", onClick: onClick, disabled: disabled, title: title, className: "inline-flex items-center gap-1.5 rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-100 hover:border-ink-600 hover:bg-ink-800 active:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent", children: children }));
}
function PrimaryButton({ children, onClick, title, disabled, }) {
    return (_jsx("button", { type: "button", onClick: onClick, disabled: disabled, title: title, className: "inline-flex items-center gap-1.5 rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 active:bg-accent-500/30 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500 disabled:hover:border-ink-700 disabled:hover:bg-ink-800", children: children }));
}
function AddLayerMenu({ onAdd, }) {
    return (_jsx("div", { className: "relative inline-block", children: _jsxs("details", { className: "group", children: [_jsxs("summary", { className: "inline-flex cursor-pointer list-none items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-ink-50 hover:bg-ink-700 [&::-webkit-details-marker]:hidden", children: [_jsx(PlusIcon, {}), " Add layer", _jsx(ChevronIcon, {})] }), _jsxs("div", { className: "absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded border border-ink-700 bg-ink-800 shadow-lg", children: [_jsxs(MenuItem, { onClick: () => onAdd("rect"), children: [_jsx(SquareIcon, {}), " Rectangle"] }), _jsxs(MenuItem, { onClick: () => onAdd("text"), children: [_jsx(TIcon, {}), " Text"] }), _jsxs(MenuItem, { onClick: () => onAdd("image"), children: [_jsx(ImageIcon, {}), " Image"] }), _jsxs(MenuItem, { onClick: () => onAdd("zone"), children: [_jsx(ZoneIcon, {}), " Zone (data bound)"] }), _jsxs(MenuItem, { onClick: () => onAdd("group"), children: [_jsx(FolderIcon, {}), " Group"] })] })] }) }));
}
function FolderIcon() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.7l1.4 1.4h5A1.5 1.5 0 0 1 14 5.9v5.6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5V4.5z" }) }));
}
function MenuItem({ children, onClick }) {
    return (_jsx("button", { type: "button", onClick: (e) => {
            const details = e.currentTarget.closest("details");
            if (details)
                details.open = false;
            onClick();
        }, className: "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-100 hover:bg-ink-700", children: children }));
}
/* ----- icons ----- */
const ico = "h-3.5 w-3.5";
function PlusIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 3v10M3 8h10" }) }));
}
function ChevronIcon() {
    return (_jsx("svg", { className: "h-3 w-3", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M4 6l4 4 4-4" }) }));
}
function SquareIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("rect", { x: "3", y: "3", width: "10", height: "10", rx: "1" }) }));
}
function TIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M3 4h10M8 4v9" }) }));
}
function ImageIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2", y: "3", width: "12", height: "10", rx: "1" }), _jsx("circle", { cx: "6", cy: "7", r: "1" }), _jsx("path", { d: "M2 12l4-3 4 2 4-3" })] }));
}
function ZoneIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeDasharray: "2 1.5", children: _jsx("rect", { x: "2.5", y: "3.5", width: "11", height: "9", rx: "1" }) }));
}
function SaveIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("path", { d: "M3 3h8l2 2v8H3z" }), _jsx("path", { d: "M5 3v4h6V3M6 13h4" })] }));
}
function DownloadIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 3v8M5 8l3 3 3-3M3 13h10" }) }));
}
function UploadIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M8 13V5M5 8l3-3 3 3M3 13v-2M13 13v-2" }) }));
}
function ExportIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2.5", y: "3.5", width: "11", height: "9", rx: "1" }), _jsx("path", { d: "M5 7l3 3 3-3" })] }));
}
function UndoIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M5 8h6a3 3 0 0 1 0 6H8M5 8l3-3M5 8l3 3" }) }));
}
function RedoIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M11 8H5a3 3 0 0 0 0 6h3M11 8L8 5M11 8l-3 3" }) }));
}
function ResetIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M3 8a5 5 0 1 0 1.5-3.5M3 3v3h3" }) }));
}
function SchemaIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "1" }), _jsx("path", { d: "M5 6h6M5 9h6M5 12h4" })] }));
}
