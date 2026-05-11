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
import { AssetExplorerView } from "@/components/AssetExplorerView";
import { SetsView } from "@/components/SetsView";
import { RulesView } from "@/components/RulesView";
import { FactionsView } from "@/components/FactionsView";
import { LoreView } from "@/components/LoreView";
import { DecksView } from "@/components/DecksView";
import { BoardsView } from "@/components/BoardsView";
import { RulesetsView } from "@/components/RulesetsView";
import { AbilitiesView } from "@/components/AbilitiesView";
import { PlaytestView } from "@/components/PlaytestView";
import { InsightsView } from "@/components/InsightsView";
import { ValidationOverviewView } from "@/components/ValidationOverviewView";
import { VariantBadgesView } from "@/components/VariantBadgesView";
import { CmsView } from "@/components/CmsView";
import { MarketplaceView } from "@/components/MarketplaceView";
import { PlatformView } from "@/components/PlatformView";
import { MembersView } from "@/components/MembersView";
import { SupportView } from "@/components/SupportView";
import { ProjectCommerceView } from "@/components/ProjectCommerceView";
import { ProfileView } from "@/components/ProfileView";
import { TasksView } from "@/components/TasksView";
import { MessagesView } from "@/components/MessagesView";
import { PlanningView } from "@/components/PlanningView";
import { SettingsView } from "@/components/SettingsView";
import { LoginView } from "@/components/LoginView";
import { StatusBar } from "@/components/StatusBar";
import { useDesigner } from "@/store/designerStore";
import { getAuthToken } from "@/lib/api";
import { TcgStudioLoader } from "@/components/TcgStudioLoader";
import { pluginHost } from "@/plugin-runtime/host";

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
  usePluginHostBridge();
  const view = useDesigner((s) => s.view);
  const currentUser = useDesigner((s) => s.currentUser);

  // Auth wall: until /auth/me has populated `currentUser`, render the login
  // page. We treat "no token in localStorage AND no currentUser yet" as the
  // unambiguous signed-out state. A token-but-no-user is a brief loading
  // window during boot — we stay on the loading state so we don't flash the
  // shell empty-handed or trigger 401s on assets with a stale token.
  if (!currentUser && !getAuthToken()) {
    return <LoginView />;
  }

  if (!currentUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 p-6">
        <TcgStudioLoader
          size="lg"
          tone="ember"
          mode="forge"
          label="Restoring session"
          sublabel="Authenticating and loading studio context..."
        />
      </div>
    );
  }

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto] bg-ink-950 font-sans text-sm">
      <Header />
      <div className="flex overflow-hidden border-y border-ink-700">
        <Sidebar />
        {/* min-h-0 + overflow-hidden together let the child decide its
            own scrolling. Without min-h-0 the flex item refuses to
            shrink below its content height and inner overflow-y-auto
            wrappers never see a bounded parent. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SectionContent view={view} />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

/**
 * View → level allow-list. Mirrors the Sidebar's filter so a user who
 * switches host (e.g. enters a project from the tenant grid) and lands
 * on a now-forbidden view doesn't get stranded on a blank screen — we
 * coerce them to the level's default view instead.
 */
const VIEW_LEVELS: Record<string, Array<"platform" | "tenant" | "project">> = {
  dashboard: ["platform", "tenant", "project"],
  projects: ["tenant"],
  cms: ["platform", "tenant", "project"],
  tenants: ["tenant"],
  settings: ["platform", "tenant", "project"],
  profile: ["platform", "tenant", "project"],
  // Members + RBAC at every level — platform admins / tenant
  // members / project members all live behind the same entry.
  members: ["platform", "tenant", "project"],
  // Support exists at every level — submit tickets that route up
  // to the parent (project→tenant→platform).
  support: ["platform", "tenant", "project"],
  // Collaboration — tenant + project scopes only.
  tasks: ["tenant", "project"],
  messages: ["tenant", "project"],
  // Marketplace — platform curates, tenants + projects browse and
  // install. Project installs are scoped to the project (provider
  // plugins, theme overrides) without touching sibling projects.
  marketplace: ["platform", "tenant", "project"],
  // Platform admin — only at platform scope.
  platform: ["platform"],
  // Planning is project-only because milestones are project-scoped.
  planning: ["project"],
  // Commerce — economy/marketing/storefront for selling creations.
  // Project-scope only; tenants don't sell directly.
  commerce: ["project"],
  // Everything else is project-scoped card design.
  card_types: ["project"],
  designer: ["project"],
  cards: ["project"],
  // Assets are tenant-scoped (the asset library hangs off the tenant id;
  // a project filter is layered on top inside AssetExplorerView). Available
  // at every level so the platform tenant can host CMS media and each
  // tenant has its own library independent of any project.
  assets: ["platform", "tenant", "project"],
  sets: ["project"],
  rules: ["project"],
  factions: ["project"],
  lore: ["project"],
  decks: ["project"],
  boards: ["project"],
  rulesets: ["project"],
  abilities: ["project"],
  playtest: ["project"],
  insights: ["project"],
  validation: ["project"],
  variant_badges: ["project"],
};

function SectionContent({ view }: { view: ReturnType<typeof useDesigner.getState>["view"] }) {
  const setView = useDesigner((s) => s.setView);
  const navLevel = useDesigner((s) => {
    const ctx = s.hostContext;
    if (!ctx) return "tenant" as const;
    return ctx.level;
  });

  // Guard: if the active view isn't valid at this host's level, redirect
  // to a sensible default. Runs as an effect so we don't cause render
  // loops by calling setView during render.
  useEffect(() => {
    const allowed = VIEW_LEVELS[view] ?? [];
    if (!allowed.includes(navLevel as "platform" | "tenant" | "project")) {
      // Default landing: dashboard at every level. The level-aware
      // DashboardView decides what to render.
      setView("dashboard");
    }
  }, [view, navLevel, setView]);

  switch (view) {
    case "dashboard":
      return <DashboardView />;
    case "tenants":
      return <TenantsView />;
    case "projects":
      return <ProjectsView />;
    case "card_types":
      return <CardTypesView />;
    case "designer":
      return <DesignerLayout />;
    case "cards":
      return <CardsView />;
    case "assets":
      return <AssetExplorerView />;
    case "sets":
      return <SetsView />;
    case "rules":
      return <RulesView />;
    case "factions":
      return <FactionsView />;
    case "lore":
      return <LoreView />;
    case "decks":
      return <DecksView />;
    case "boards":
      return <BoardsView />;
    case "rulesets":
      return <RulesetsView />;
    case "abilities":
      return <AbilitiesView />;
    case "playtest":
      return <PlaytestView />;
    case "insights":
      return <InsightsView />;
    case "validation":
      return <ValidationOverviewView />;
    case "variant_badges":
      return <VariantBadgesView />;
    case "cms":
      return <CmsView />;
    case "marketplace":
      return <MarketplaceView />;
    case "platform":
      return <PlatformView />;
    case "members":
      return <MembersView />;
    case "support":
      return <SupportView />;
    case "commerce":
      return <ProjectCommerceView />;
    case "tasks":
      return <TasksView />;
    case "messages":
      return <MessagesView />;
    case "planning":
      return <PlanningView />;
    case "profile":
      return <ProfileView />;
    case "settings":
      return <SettingsView />;
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
  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <ResizableSidebar side="left" storageKey="designer.left" defaultWidth={260}>
        <div className="grid h-full grid-rows-[1fr_minmax(180px,40%)] overflow-hidden bg-ink-900">
          <div className="overflow-y-auto">
            <LayerTree />
          </div>
          <div className="overflow-hidden border-t border-ink-700">
            <CardDataPanel />
          </div>
        </div>
      </ResizableSidebar>

      <main className="relative flex-1 overflow-hidden bg-ink-950">
        <CanvasStage />
      </main>

      <ResizableSidebar side="right" storageKey="designer.right" defaultWidth={320}>
        <div className="grid h-full grid-rows-[1fr_minmax(160px,40%)] overflow-hidden bg-ink-900">
          <div className="overflow-y-auto">
            <Inspector />
          </div>
          <div className="overflow-hidden border-t border-ink-700">
            <ValidationPanel />
          </div>
        </div>
      </ResizableSidebar>
    </div>
  );
}



/**
 * On first mount, ask the API for the tenant's projects + active template.
 */
function useBootstrapApi() {
  const loadInitial = useDesigner((s) => s.loadInitial);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadInitial();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadInitial]);
}

/**
 * Keep the plugin runtime fed with the latest host context. Subscribed
 * once at the app shell — every mounted plugin iframe sees the same
 * state via `pluginHost.snapshotContext()` when its `init` fires.
 *
 * We push a fresh snapshot any time tenants / projects / active
 * tenant slug / active project change. The host caches the snapshot
 * and re-emits a `host.context` event over the bridge later when
 * we wire context-change push (TODO).
 */
function usePluginHostBridge() {
  useEffect(() => {
    return useDesigner.subscribe((s) => {
      pluginHost.setHostState({
        tenants: s.tenants,
        projects: s.projects,
        activeTenantSlug: s.activeTenantSlug,
        activeProjectId: s.activeProjectId,
      });
    });
  }, []);
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
    if (view !== "designer") return;

    function isEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      // Editing in a form input — bail before any of the global handlers fire.
      if (isEditable(e.target)) return;

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
