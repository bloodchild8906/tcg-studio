import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { LayerTree } from "@/components/LayerTree";
import { CanvasStage } from "@/components/CanvasStage";
import { Inspector } from "@/components/Inspector";
import { ValidationPanel } from "@/components/Validation";
import { CardDataPanel } from "@/components/CardDataPanel";
import { ResizableSidebar } from "@/components/ResizableSidebar";
import { CardsView } from "@/components/CardsView";
import { CardTypesView } from "@/components/CardTypesView";
import { DashboardView } from "@/components/DashboardView";
import { ProjectsView } from "@/components/ProjectsView";
import { TenantsView } from "@/components/TenantsView";
import { AssetsView } from "@/components/AssetsView";
import { SetsView } from "@/components/SetsView";
import { RulesView } from "@/components/RulesView";
import { FactionsView } from "@/components/FactionsView";
import { LoreView } from "@/components/LoreView";
import { DecksView } from "@/components/DecksView";
import { BoardsView } from "@/components/BoardsView";
import { SettingsView } from "@/components/SettingsView";
import { LoginView } from "@/components/LoginView";
import { StatusBar } from "@/components/StatusBar";
import { useDesigner } from "@/store/designerStore";
import { getAuthToken } from "@/lib/api";
/**
 * Top-level shell.
 *
 * Layout:
 *
 *   ┌────────────────────────────── header ──────────────────────────────┐
 *   │ logo · project picker · save badge · toolbar (when relevant)       │
 *   ├────┬───────────────────────────────────────────────────────────────┤
 *   │ ⌂  │                                                               │
 *   │ ▢  │                  active section content                       │
 *   │ ☰  │                                                               │
 *   │ ⚙  │                                                               │
 *   ├────┴───────────────────────────────────────────────────────────────┤
 *   │ status bar                                                         │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * The sidebar is icon-only (52px wide) so the designer view still has room to
 * breathe. The active section is one of:
 *   • Dashboard       — home, stats, shortcuts
 *   • Card Types      — grid of card types in the active project
 *   • Designer        — template editor for the active card type
 *   • Cards           — list + schema-driven editor for cards
 *   • Settings        — tenant / API info (placeholder)
 *
 * Section transitions are state-only — `useDesigner.view` decides what mounts.
 */
export default function App() {
    useGlobalShortcuts();
    useBootstrapApi();
    const view = useDesigner((s) => s.view);
    const currentUser = useDesigner((s) => s.currentUser);
    // Auth wall: until /auth/me has populated `currentUser`, render the login
    // page. We treat "no token in localStorage AND no currentUser yet" as the
    // unambiguous signed-out state. A token-but-no-user is a brief loading
    // window during boot — we stay on the loading state so we don't flash the
    // shell empty-handed or trigger 401s on assets with a stale token.
    if (!currentUser && !getAuthToken()) {
        return _jsx(LoginView, {});
    }
    if (!currentUser) {
        return (_jsx("div", { className: "flex h-screen items-center justify-center bg-ink-950 p-6 text-ink-400", children: _jsxs("div", { className: "flex flex-col items-center gap-3", children: [_jsx("div", { className: "h-5 w-5 animate-spin rounded-full border-2 border-ink-700 border-t-accent-500" }), _jsx("p", { className: "text-xs uppercase tracking-widest", children: "Restoring session\u2026" })] }) }));
    }
    return (_jsxs("div", { className: "grid h-screen grid-rows-[auto_1fr_auto] bg-ink-950 font-sans text-sm", children: [_jsx(Header, {}), _jsxs("div", { className: "flex overflow-hidden border-y border-ink-700", children: [_jsx(Sidebar, {}), _jsx("main", { className: "flex-1 min-w-0", children: _jsx(SectionContent, { view: view }) })] }), _jsx(StatusBar, {})] }));
}
function SectionContent({ view }) {
    switch (view) {
        case "dashboard":
            return _jsx(DashboardView, {});
        case "tenants":
            return _jsx(TenantsView, {});
        case "projects":
            return _jsx(ProjectsView, {});
        case "card_types":
            return _jsx(CardTypesView, {});
        case "designer":
            return _jsx(DesignerLayout, {});
        case "cards":
            return _jsx(CardsView, {});
        case "assets":
            return _jsx(AssetsView, {});
        case "sets":
            return _jsx(SetsView, {});
        case "rules":
            return _jsx(RulesView, {});
        case "factions":
            return _jsx(FactionsView, {});
        case "lore":
            return _jsx(LoreView, {});
        case "decks":
            return _jsx(DecksView, {});
        case "boards":
            return _jsx(BoardsView, {});
        case "settings":
            return _jsx(SettingsView, {});
    }
}
/**
 * Designer layout — three-pane editor (layer tree / canvas / inspector + validation).
 * Used by the Card Type Designer when a card type is active.
 *
 * Both side panels are wrapped in `ResizableSidebar`, which provides:
 *   • drag handle on the inner edge (resize within min/max)
 *   • collapse-to-thin-bar via header chevron or double-click on handle
 *   • per-panel localStorage persistence
 *
 * The center main area uses flex-1 so it expands/shrinks as the user
 * resizes either side panel.
 */
function DesignerLayout() {
    return (_jsxs("div", { className: "flex h-full flex-1 overflow-hidden", children: [_jsx(ResizableSidebar, { side: "left", storageKey: "designer.left", defaultWidth: 260, children: _jsxs("div", { className: "grid h-full grid-rows-[1fr_minmax(180px,40%)] overflow-hidden bg-ink-900", children: [_jsx("div", { className: "overflow-y-auto", children: _jsx(LayerTree, {}) }), _jsx("div", { className: "overflow-hidden border-t border-ink-700", children: _jsx(CardDataPanel, {}) })] }) }), _jsx("main", { className: "relative flex-1 overflow-hidden bg-ink-950", children: _jsx(CanvasStage, {}) }), _jsx(ResizableSidebar, { side: "right", storageKey: "designer.right", defaultWidth: 320, children: _jsxs("div", { className: "grid h-full grid-rows-[1fr_minmax(160px,40%)] overflow-hidden bg-ink-900", children: [_jsx("div", { className: "overflow-y-auto", children: _jsx(Inspector, {}) }), _jsx("div", { className: "overflow-hidden border-t border-ink-700", children: _jsx(ValidationPanel, {}) })] }) })] }));
}
/**
 * On first mount, ask the API for the tenant's projects + active template.
 */
function useBootstrapApi() {
    const loadInitial = useDesigner((s) => s.loadInitial);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            if (cancelled)
                return;
            await loadInitial();
        })();
        return () => {
            cancelled = true;
        };
    }, [loadInitial]);
}
/**
 * Global keyboard shortcuts.
 *
 *   Ctrl/Cmd+Z          → undo
 *   Ctrl/Cmd+Shift+Z    → redo
 *   Ctrl/Cmd+Y          → redo (Windows convention)
 *
 * Only active in the Designer view to avoid hijacking forms in Cards / Settings.
 */
function useGlobalShortcuts() {
    const undo = useDesigner((s) => s.undo);
    const redo = useDesigner((s) => s.redo);
    const removeSelectedLayers = useDesigner((s) => s.removeSelectedLayers);
    const clearSelection = useDesigner((s) => s.clearSelection);
    const view = useDesigner((s) => s.view);
    useEffect(() => {
        if (view !== "designer")
            return;
        function isEditable(target) {
            if (!(target instanceof HTMLElement))
                return false;
            const tag = target.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
                return true;
            if (target.isContentEditable)
                return true;
            return false;
        }
        function onKey(e) {
            // Editing in a form input — bail before any of the global handlers fire.
            if (isEditable(e.target))
                return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            // Undo / redo
            if (mod) {
                const isUndo = key === "z" && !e.shiftKey;
                const isRedo = (key === "z" && e.shiftKey) || key === "y";
                if (isUndo) {
                    e.preventDefault();
                    undo();
                    return;
                }
                if (isRedo) {
                    e.preventDefault();
                    redo();
                    return;
                }
            }
            // Delete / Backspace removes the current selection.
            if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                removeSelectedLayers();
                return;
            }
            // Escape clears the selection — useful when a user wants the inspector
            // empty without clicking the canvas background.
            if (e.key === "Escape") {
                clearSelection();
                return;
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [undo, redo, removeSelectedLayers, clearSelection, view]);
}
