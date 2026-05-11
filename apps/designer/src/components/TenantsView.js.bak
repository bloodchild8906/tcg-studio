import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useDesigner } from "@/store/designerStore";
/**
 * Tenants view — top-level grid of every tenant the platform knows about.
 *
 * Spec sec 9.3: a tenant is the main customer workspace; in this product
 * each tenant is effectively one creator's studio. Switching tenant changes
 * the entire visible scope (projects, card types, cards, assets — all are
 * tenant-isolated server-side).
 *
 * Why this view exists: until now the tenant was hardcoded to the seeded
 * "demo". To actually use TCGStudio multi-tenant, you need to be able to
 * see every tenant in your platform, create new ones, and switch between
 * them. The view tile is just the surface — `selectTenant` in the store
 * does the heavy lifting (clears caches, reloads projects).
 *
 * Layout mirrors ProjectsView for muscle-memory consistency.
 */
export function TenantsView() {
    const tenants = useDesigner((s) => s.tenants);
    const activeSlug = useDesigner((s) => s.activeTenantSlug);
    const selectTenant = useDesigner((s) => s.selectTenant);
    const deleteTenant = useDesigner((s) => s.deleteTenant);
    const setView = useDesigner((s) => s.setView);
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-6xl p-6", children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: "Platform" }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Tenants" }), _jsx("p", { className: "mt-1 text-xs text-ink-400", children: "Each tenant is its own studio workspace \u2014 projects, card types, cards, and assets are fully isolated. Switch tenant and the entire app re-scopes." })] }), _jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3", children: [_jsx(NewTenantTile, {}), tenants.map((t) => (_jsx(TenantTile, { tenant: t, isActive: t.slug === activeSlug, onOpen: async () => {
                                await selectTenant(t.slug);
                                setView("dashboard");
                            }, onDelete: () => {
                                if (confirm(`Delete tenant "${t.name}"?\nThis removes ALL projects, card types, cards, assets, and members. Cannot be undone.`)) {
                                    void deleteTenant(t.id);
                                }
                            } }, t.id)))] }), tenants.length === 0 && (_jsx("p", { className: "mt-6 text-sm text-ink-500", children: "No tenants exist. Create one above to get started." }))] }) }));
}
function TenantTile({ tenant, isActive, onOpen, onDelete, }) {
    return (_jsxs("li", { className: [
            "group flex flex-col overflow-hidden rounded-lg border bg-ink-900 transition-colors hover:border-accent-500/40",
            isActive ? "border-accent-500/50 ring-1 ring-accent-500/30" : "border-ink-700",
        ].join(" "), children: [_jsxs("button", { type: "button", onClick: onOpen, className: "flex flex-1 flex-col gap-2 p-4 text-left", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-sm font-medium text-ink-50", children: tenant.name }), _jsx("p", { className: "truncate font-mono text-[10px] text-ink-500", children: tenant.slug })] }), _jsx(StatusPill, { status: tenant.status })] }), _jsx(TenantGlyph, { slug: tenant.slug }), _jsxs("div", { className: "mt-auto flex items-center gap-2 text-[10px] text-ink-500", children: [_jsxs("span", { children: ["updated ", formatRelative(tenant.updatedAt)] }), isActive && (_jsx("span", { className: "ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300", children: "active" }))] })] }), _jsxs("div", { className: "flex border-t border-ink-800", children: [_jsx("button", { type: "button", onClick: onOpen, className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: "Switch into" }), _jsx("button", { type: "button", onClick: onDelete, disabled: isActive, title: isActive ? "Switch to another tenant first" : "Delete tenant", className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-500", children: "Delete" })] })] }));
}
/** A tiny visual decoration so each tile has its own face. */
function TenantGlyph({ slug }) {
    // Hash the slug to a hue so the same tenant always shows the same accent.
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
        hash = (hash * 31 + slug.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return (_jsxs("div", { className: "relative h-16 w-full overflow-hidden rounded", children: [_jsx("div", { className: "absolute inset-0", style: {
                    background: `linear-gradient(135deg, hsl(${hue} 60% 28%) 0%, hsl(${(hue + 40) % 360} 50% 16%) 100%)`,
                } }), _jsx("svg", { className: "absolute inset-0 h-full w-full", viewBox: "0 0 100 30", children: _jsx("text", { x: "50", y: "20", textAnchor: "middle", fontSize: "14", fontFamily: "serif", fill: "rgba(255,255,255,0.85)", fontWeight: "600", children: slug.slice(0, 2).toUpperCase() }) })] }));
}
function StatusPill({ status }) {
    const map = {
        trial: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        past_due: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        suspended: "border-danger-500/40 bg-danger-500/10 text-danger-500",
        disabled: "border-ink-700 bg-ink-800 text-ink-500",
        pending_deletion: "border-danger-500/40 bg-danger-500/10 text-danger-500",
    };
    return (_jsx("span", { className: `shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${map[status] ?? map.active}`, children: status }));
}
function formatRelative(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms))
        return "—";
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60)
        return "just now";
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30)
        return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}
/* ---------------------------------------------------------------------- */
/* + new tile                                                             */
/* ---------------------------------------------------------------------- */
function NewTenantTile() {
    const createTenant = useDesigner((s) => s.createTenant);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [busy, setBusy] = useState(false);
    function autoSlug(n) {
        return n
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }
    async function submit(e) {
        e.preventDefault();
        if (!name.trim())
            return;
        setBusy(true);
        try {
            await createTenant({
                name: name.trim(),
                slug: (slug.trim() || autoSlug(name)) || "tenant",
            });
            setName("");
            setSlug("");
            setOpen(false);
        }
        finally {
            setBusy(false);
        }
    }
    if (!open) {
        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setOpen(true), className: "flex h-full min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300", children: [_jsx(PlusIcon, {}), _jsx("span", { className: "text-xs font-medium", children: "New tenant" }), _jsx("span", { className: "text-[10px] text-ink-500", children: "Studio, publisher, school, \u2026" })] }) }));
    }
    return (_jsx("li", { children: _jsxs("form", { onSubmit: submit, className: "flex h-full min-h-[180px] flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3", children: [_jsx("p", { className: "text-[10px] uppercase tracking-wider text-accent-300", children: "New tenant" }), _jsx("input", { type: "text", value: name, onChange: (e) => {
                        setName(e.target.value);
                        if (!slug)
                            setSlug(autoSlug(e.target.value));
                    }, placeholder: "Studio name", autoFocus: true, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }), _jsx("input", { type: "text", value: slug, onChange: (e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-")), placeholder: "slug", className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-100" }), _jsx("p", { className: "text-[10px] text-ink-500", children: "Slug becomes the tenant's URL prefix and the X-Tenant-Slug header value." }), _jsxs("div", { className: "mt-auto flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setOpen(false), className: "flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name.trim(), className: "flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40", children: busy ? "Creating…" : "Create" })] })] }) }));
}
function PlusIcon() {
    return (_jsx("svg", { className: "h-6 w-6", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M12 5v14M5 12h14" }) }));
}
