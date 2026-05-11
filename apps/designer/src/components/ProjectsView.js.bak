import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useDesigner } from "@/store/designerStore";
/**
 * Projects view — top-level grid of every project in the tenant.
 *
 * Spec sec 16 puts projects as the container for everything else (card types,
 * cards, assets, sets…). Until this view existed, the user was pinned to
 * whichever project the seed wrote — fine for a demo, blocking for real use.
 *
 * Layout mirrors CardTypesView for consistency:
 *   • "+ New project" tile first so it's always reachable
 *   • Existing projects as tiles with stats + open / delete
 *
 * Clicking a project tile selects it AND navigates to the dashboard so the
 * user immediately sees the project's stats. Switching projects via the
 * header dropdown stays where you are — different intents.
 */
export function ProjectsView() {
    const projects = useDesigner((s) => s.projects);
    const activeProjectId = useDesigner((s) => s.activeProjectId);
    const selectProject = useDesigner((s) => s.selectProject);
    const setView = useDesigner((s) => s.setView);
    const deleteProject = useDesigner((s) => s.deleteProject);
    return (_jsx("div", { className: "overflow-y-auto bg-ink-950", children: _jsxs("div", { className: "mx-auto max-w-6xl p-6", children: [_jsxs("header", { className: "mb-6", children: [_jsx("p", { className: "text-[11px] uppercase tracking-wider text-ink-400", children: "Tenant" }), _jsx("h1", { className: "mt-1 text-xl font-semibold text-ink-50", children: "Projects" }), _jsx("p", { className: "mt-1 text-xs text-ink-400", children: "Each project is a card game. Card types, cards, assets, and sets all live under one project." })] }), _jsxs("ul", { className: "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3", children: [_jsx(NewProjectTile, {}), projects.map((p) => (_jsx(ProjectTile, { project: p, isActive: p.id === activeProjectId, onOpen: async () => {
                                await selectProject(p.id);
                                setView("dashboard");
                            }, onDelete: () => {
                                if (confirm(`Delete project "${p.name}"?\nThis removes all card types, cards, and assets in it.`)) {
                                    void deleteProject(p.id);
                                }
                            } }, p.id)))] }), projects.length === 0 && (_jsx("p", { className: "mt-6 text-sm text-ink-500", children: "No projects yet \u2014 create your first one above." }))] }) }));
}
function ProjectTile({ project, isActive, onOpen, onDelete, }) {
    return (_jsxs("li", { className: [
            "group flex flex-col overflow-hidden rounded-lg border bg-ink-900 transition-colors hover:border-accent-500/40",
            isActive ? "border-accent-500/50 ring-1 ring-accent-500/30" : "border-ink-700",
        ].join(" "), children: [_jsxs("button", { type: "button", onClick: onOpen, className: "flex flex-1 flex-col gap-2 p-4 text-left", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-sm font-medium text-ink-50", children: project.name }), _jsx("p", { className: "truncate font-mono text-[10px] text-ink-500", children: project.slug })] }), _jsx(StatusPill, { status: project.status })] }), project.description && (_jsx("p", { className: "line-clamp-3 text-[11px] leading-snug text-ink-400", children: project.description })), _jsxs("div", { className: "mt-auto flex items-center gap-2 text-[10px] text-ink-500", children: [_jsxs("span", { children: ["v", project.version] }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["updated ", formatRelative(project.updatedAt)] }), isActive && (_jsx("span", { className: "ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300", children: "active" }))] })] }), _jsxs("div", { className: "flex border-t border-ink-800", children: [_jsx("button", { type: "button", onClick: onOpen, className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100", children: "Open" }), _jsx("button", { type: "button", onClick: onDelete, className: "flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500", children: "Delete" })] })] }));
}
function StatusPill({ status }) {
    const map = {
        idea: "border-ink-700 bg-ink-800 text-ink-400",
        draft: "border-ink-700 bg-ink-800 text-ink-400",
        prototype: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        playtesting: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        production: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        released: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        archived: "border-ink-700 bg-ink-800 text-ink-600",
    };
    return (_jsx("span", { className: `shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${map[status] ?? map.draft}`, children: status }));
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
function NewProjectTile() {
    const createProject = useDesigner((s) => s.createProject);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [description, setDescription] = useState("");
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
            await createProject({
                name: name.trim(),
                slug: (slug.trim() || autoSlug(name)) || "project",
                description: description.trim() || undefined,
            });
            setName("");
            setSlug("");
            setDescription("");
            setOpen(false);
        }
        finally {
            setBusy(false);
        }
    }
    if (!open) {
        return (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => setOpen(true), className: "flex h-full min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300", children: [_jsx(PlusIcon, {}), _jsx("span", { className: "text-xs font-medium", children: "New project" }), _jsx("span", { className: "text-[10px] text-ink-500", children: "Saga, Spell Forge, \u2026" })] }) }));
    }
    return (_jsx("li", { children: _jsxs("form", { onSubmit: submit, className: "flex h-full min-h-[180px] flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3", children: [_jsx("p", { className: "text-[10px] uppercase tracking-wider text-accent-300", children: "New project" }), _jsx("input", { type: "text", value: name, onChange: (e) => {
                        setName(e.target.value);
                        if (!slug)
                            setSlug(autoSlug(e.target.value));
                    }, placeholder: "Project name", autoFocus: true, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }), _jsx("input", { type: "text", value: slug, onChange: (e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-")), placeholder: "slug", className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-100" }), _jsx("textarea", { value: description, onChange: (e) => setDescription(e.target.value), rows: 2, placeholder: "Short description (optional)", className: "block w-full resize-none rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100" }), _jsxs("div", { className: "mt-auto flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setOpen(false), className: "flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800", children: "Cancel" }), _jsx("button", { type: "submit", disabled: busy || !name.trim(), className: "flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40", children: busy ? "Creating…" : "Create" })] })] }) }));
}
function PlusIcon() {
    return (_jsx("svg", { className: "h-6 w-6", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M12 5v14M5 12h14" }) }));
}
