import { useEffect, useState } from "react";
import { selectNavLevel, useDesigner } from "@/store/designerStore";

/**
 * Persistent app sidebar.
 *
 * Icon-only by design — the designer / card-editor views need every column
 * pixel they can get, so labels stay in tooltips. The active section gets
 * an accent indicator on the left edge.
 *
 * Level-aware: which buttons are visible depends on the active host
 * level (sec 9.1):
 *   • Tenant scope (`acme.tcgstudio.local`) — management only:
 *     dashboard, projects, public site (CMS), settings.
 *   • Project scope (`saga.acme.tcgstudio.local`) — card-design tools:
 *     card types, cards, assets, rules, abilities, factions, lore,
 *     sets, decks, boards, rulesets, badges, playtest, insights,
 *     validation. Settings still available for per-project preferences.
 *   • Platform scope is handled by a different shell (LandingPage),
 *     so this sidebar never renders at that level.
 *
 * The level → views mapping intentionally has zero overlap on the
 * card-design side: the platform's structural promise is "you only
 * see card editors when you're inside a project", and that's what
 * users see here.
 */
type Level = "platform" | "tenant" | "project";

interface NavSpec {
  view: View;
  label: string;
  levels: Level[];
  icon: () => JSX.Element;
  /** Hides this entry when no project is selected (legacy gate). */
  requiresProject?: boolean;
  /** Hides this entry unless the signed-in user has a non-null
   *  platformRole. */
  requiresPlatformRole?: boolean;
}

type View =
  | "dashboard"
  | "projects"
  | "card_types"
  | "designer"
  | "cards"
  | "assets"
  | "sets"
  | "rules"
  | "factions"
  | "lore"
  | "decks"
  | "boards"
  | "rulesets"
  | "abilities"
  | "playtest"
  | "insights"
  | "validation"
  | "variant_badges"
  | "cms"
  | "tasks"
  | "messages"
  | "planning"
  | "marketplace"
  | "platform"
  | "members"
  | "support"
  | "commerce"
  | "profile"
  | "settings";

const NAV: NavSpec[] = [
  // ----- Tenant management -------------------------------------------------
  {
    view: "dashboard",
    label: "Dashboard",
    // All three levels — each renders a different dashboard component
    // (PlatformDashboard / TenantDashboard / ProjectDashboard).
    levels: ["platform", "tenant", "project"],
    icon: DashboardIcon,
  },
  {
    view: "projects",
    label: "Projects",
    // Tenant-only by design. Platform never sees a project list —
    // platform manages tenants, tenants manage projects.
    levels: ["tenant"],
    icon: ProjectsIcon,
  },
  {
    view: "cms",
    label: "Public site",
    // Platform CMS = the marketing landing at tcgstudio.local;
    // tenant CMS = the tenant's branded public site; project CMS =
    // the per-game site. Each level edits its own.
    levels: ["platform", "tenant", "project"],
    icon: CmsIcon,
  },
  {
    view: "marketplace",
    label: "Marketplace",
    // Available at every level except platform-visitor:
    //   - Platform admins curate the global marketplace + handle
    //     theme/plugin submissions.
    //   - Tenants browse + install plugins/themes for the workspace.
    //   - Projects browse + install plugins/themes scoped to the
    //     project (each project picks its own provider plugins,
    //     theme overrides, etc.).
    levels: ["platform", "tenant", "project"],
    icon: MarketplaceIcon,
  },
  {
    view: "platform",
    label: "Platform admin",
    // Only available at platform scope and only to users who hold
    // a platformRole. Showing it inside a tenant/project would be
    // misleading — the platform admin surface is cross-tenant.
    levels: ["platform"],
    icon: PlatformIcon,
    requiresPlatformRole: true,
  },
  {
    view: "members",
    label: "Members",
    // Members + RBAC at every level. Each level shows the matching
    // membership list (PlatformAdminsSection / MembersSection /
    // ProjectMembersSection) plus the RolesSection so admins can
    // manage roles + permissions in one place.
    levels: ["platform", "tenant", "project"],
    icon: MembersIcon,
  },
  {
    view: "tasks",
    label: "Tasks",
    levels: ["tenant", "project"],
    icon: TasksIcon,
  },
  {
    view: "messages",
    label: "Messages",
    levels: ["tenant", "project"],
    icon: MessagesIcon,
  },
  {
    view: "planning",
    label: "Planning",
    levels: ["project"],
    icon: PlanningIcon,
    requiresProject: true,
  },
  {
    view: "support",
    label: "Support",
    // Support exists at every level — platform admins triage tickets,
    // tenants/projects open them. Same view, different audience.
    levels: ["platform", "tenant", "project"],
    icon: SupportIcon,
  },

  // ----- Card design (project scope) --------------------------------------
  {
    view: "card_types",
    label: "Card types",
    levels: ["project"],
    icon: CardTypesIcon,
    requiresProject: true,
  },
  {
    view: "cards",
    label: "Cards",
    levels: ["project"],
    icon: CardsIcon,
    requiresProject: true,
  },
  {
    // Assets are tenant-scoped (see apps/api/src/routes/assets.ts) — they
    // can hang off a project for organization but the tenant is the unit
    // of isolation. So we expose the view at platform + tenant + project
    // levels: the platform tenant gets its own library for the marketing
    // CMS, every tenant gets one for their own CMS / cards / branding,
    // and project scope filters to just that project's assets.
    view: "assets",
    label: "Assets",
    levels: ["platform", "tenant", "project"],
    icon: AssetsIcon,
  },
  {
    view: "rules",
    label: "Keywords",
    levels: ["project"],
    icon: RulesIcon,
    requiresProject: true,
  },
  {
    view: "abilities",
    label: "Abilities",
    levels: ["project"],
    icon: AbilitiesIcon,
    requiresProject: true,
  },
  {
    view: "variant_badges",
    label: "Badges",
    levels: ["project"],
    icon: BadgesIcon,
    requiresProject: true,
  },
  {
    view: "factions",
    label: "Factions",
    levels: ["project"],
    icon: FactionsIcon,
    requiresProject: true,
  },
  {
    view: "lore",
    label: "Lore",
    levels: ["project"],
    icon: LoreIcon,
    requiresProject: true,
  },
  {
    view: "sets",
    label: "Sets",
    levels: ["project"],
    icon: SetsIcon,
    requiresProject: true,
  },
  {
    view: "decks",
    label: "Decks",
    levels: ["project"],
    icon: DecksIcon,
    requiresProject: true,
  },
  {
    view: "boards",
    label: "Boards",
    levels: ["project"],
    icon: BoardIcon,
    requiresProject: true,
  },
  {
    view: "rulesets",
    label: "Rulesets",
    levels: ["project"],
    icon: RulesetsIcon,
    requiresProject: true,
  },
  {
    view: "playtest",
    label: "Playtest",
    levels: ["project"],
    icon: PlaytestIcon,
    requiresProject: true,
  },
  {
    view: "commerce",
    label: "Commerce",
    // Project-scope only — economy, marketing, storefront for the
    // creations made in THIS project. Tenants don't sell directly;
    // each project decides whether to monetize.
    levels: ["project"],
    icon: CommerceIcon,
    requiresProject: true,
  },
  {
    view: "insights",
    label: "Insights",
    levels: ["project"],
    icon: InsightsIcon,
    requiresProject: true,
  },
  {
    view: "validation",
    label: "Validation",
    levels: ["project"],
    icon: ValidationIcon,
    requiresProject: true,
  },

  // ----- Settings (every level) -------------------------------------------
  {
    view: "settings",
    label: "Settings",
    levels: ["platform", "tenant", "project"],
    icon: SettingsIcon,
  },
];

/**
 * Collapsible navigation groups. Order matters: each entry from NAV is
 * placed under the FIRST group whose `views` set contains its view id.
 * Anything not matched falls into the "Other" bucket so we never lose
 * an entry from the rail. Group order top → bottom is the user's
 * intuitive workflow: arrive at the workspace, manage the public site,
 * design things, define rules, play, ship, collaborate, configure.
 */
interface NavGroup {
  id: string;
  label: string;
  views: ReadonlyArray<View>;
  /** Is this group open by default when first seen? */
  defaultOpen?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    views: ["dashboard", "projects"],
    defaultOpen: true,
  },
  {
    id: "site",
    label: "Site & store",
    views: ["cms", "marketplace"],
    defaultOpen: true,
  },
  {
    id: "design",
    label: "Design",
    views: ["card_types", "cards", "assets", "factions", "sets", "lore"],
    defaultOpen: true,
  },
  {
    id: "rules",
    label: "Rules",
    views: ["rules", "abilities", "variant_badges", "rulesets"],
  },
  {
    id: "play",
    label: "Play",
    views: ["decks", "boards", "playtest"],
  },
  {
    id: "commerce",
    label: "Commerce",
    views: ["commerce"],
  },
  {
    id: "quality",
    label: "Quality",
    views: ["insights", "validation"],
  },
  {
    id: "collab",
    label: "Collaborate",
    views: ["tasks", "messages", "planning"],
  },
  {
    id: "help",
    label: "Help",
    views: ["support"],
    defaultOpen: true,
  },
  {
    id: "admin",
    label: "Admin",
    views: ["platform", "members", "settings", "profile"],
    defaultOpen: true,
  },
];

const SIDEBAR_EXPANDED_KEY = "tcgstudio.sidebar.expanded";
const SIDEBAR_GROUPS_KEY = "tcgstudio.sidebar.groups";

/** Read the persisted "is the sidebar expanded?" preference. Default
 *  to collapsed (icon rail) so the design surface keeps its width. */
function readExpandedPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Read the persisted per-group open/closed state. Missing groups
 *  fall back to the spec's `defaultOpen`. */
function readGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, boolean>;
    }
  } catch {
    /* ignore — fallback to defaults */
  }
  return {};
}

export function Sidebar() {
  const view = useDesigner((s) => s.view);
  const setView = useDesigner((s) => s.setView);
  const activeProjectId = useDesigner((s) => s.activeProjectId);
  const navLevel = useDesigner(selectNavLevel);
  const platformRole = useDesigner((s) => s.platformRole);

  // Sidebar mode: collapsed = icon rail (existing behavior), expanded
  // = full-width with labels and collapsible group headers. Persists
  // across sessions in localStorage so the user's preference sticks.
  //
  // IMPORTANT: every hook in this component must run on every render
  // — Rules of Hooks. The platform-non-admin early return below MUST
  // come AFTER all hooks have been declared, otherwise we get
  // "Rendered more hooks than during the previous render" the first
  // time `platformRole` resolves from the API and changes the branch.
  const [expanded, setExpanded] = useState<boolean>(() => readExpandedPref());
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, expanded ? "1" : "0");
    } catch {
      /* ignore quota / privacy errors */
    }
  }, [expanded]);

  // Per-group open/closed state — only meaningful in expanded mode.
  // Collapsed-rail mode flattens everything because there's no room
  // to render group headers.
  const [groupState, setGroupState] = useState<Record<string, boolean>>(() =>
    readGroupState(),
  );
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(groupState));
    } catch {
      /* ignore */
    }
  }, [groupState]);

  // Non-admin platform visitors still need a basic sidebar so they
  // can reach Support, Settings, and the Dashboard. The "Platform
  // admin" entry hides itself via `requiresPlatformRole`, so the
  // filter below is the only gate we need.

  // Sidebar level is the host's level verbatim — platform / tenant /
  // project. We used to collapse platform→tenant so platform admins
  // would see the tenant nav entries, but that leaked Projects /
  // Tasks / Messages / Planning into the platform shell. Now each
  // NavSpec opts in to platform explicitly via `levels: ["platform",
  // ...]`. Platform shows: Dashboard, Public site (CMS), Marketplace,
  // Platform admin, Support, Settings — and nothing else.
  const levelKey: Level = navLevel;
  const visible = NAV.filter((n) => {
    if (!n.levels.includes(levelKey)) return false;
    if (n.requiresPlatformRole && !platformRole) return false;
    return true;
  });

  // Build groups: each group keeps a list of nav specs that belong to
  // it. We assign each spec to the FIRST group whose `views` includes
  // the spec's view id; anything left over lands in a synthetic
  // "Other" group at the bottom so we never silently drop entries.
  const grouped: Array<{ group: NavGroup; entries: NavSpec[] }> = NAV_GROUPS.map(
    (g) => ({ group: g, entries: [] as NavSpec[] }),
  );
  const fallback: NavSpec[] = [];
  for (const spec of visible) {
    const slot = grouped.find((g) => g.group.views.includes(spec.view));
    if (slot) slot.entries.push(spec);
    else fallback.push(spec);
  }

  function isGroupOpen(g: NavGroup): boolean {
    if (g.id in groupState) return groupState[g.id];
    return Boolean(g.defaultOpen);
  }
  function toggleGroup(id: string, currentlyOpen: boolean) {
    setGroupState((prev) => ({ ...prev, [id]: !currentlyOpen }));
  }

  function renderEntry(spec: NavSpec) {
    const Ico = spec.icon;
    const disabled =
      spec.requiresProject === true &&
      !activeProjectId &&
      levelKey === "project";
    const isActive =
      view === spec.view ||
      (spec.view === "card_types" && view === "designer");
    return (
      <NavButton
        key={spec.view}
        icon={<Ico />}
        label={spec.label}
        active={isActive}
        disabled={disabled}
        expanded={expanded}
        onClick={() => setView(spec.view)}
      />
    );
  }

  // Collapsed rail mode — the original icon-only behavior, preserved
  // for users who like every pixel of the design canvas. Group
  // headers don't render here; we just flatten in declaration order.
  //
  // The rail itself is `h-full` and the middle slot is its own
  // `overflow-y-auto` scroller so a long nav (project scope has 14+
  // entries) doesn't push Settings off the bottom. The expand toggle
  // and Settings stay pinned outside the scroller.
  if (!expanded) {
    return (
      <nav className="flex h-full w-14 flex-col items-center border-r border-ink-700 bg-ink-900 py-3">
        <ExpandToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        <div className="mt-1 h-px w-8 shrink-0 bg-ink-700" />
        <div className="sidebar-scroll flex flex-1 min-h-0 w-full flex-col items-center gap-1 overflow-y-auto py-1">
          {grouped.flatMap((g, idx) => [
            // Tiny inter-group separator line so the rail still has
            // visual rhythm. We skip it before the first group.
            ...(idx > 0 && g.entries.length > 0
              ? [<div key={`sep-${g.group.id}`} className="my-1 h-px w-6 bg-ink-800" />]
              : []),
            ...g.entries
              .filter((s) => s.view !== "settings")
              .map(renderEntry),
          ])}
          {fallback.filter((s) => s.view !== "settings").map(renderEntry)}
        </div>
        <div className="flex w-full flex-col items-center gap-1 pt-1">
          {visible.filter((n) => n.view === "settings").map(renderEntry)}
        </div>
      </nav>
    );
  }

  // Expanded mode — full labels, collapsible group headers, more room
  // to breathe. Groups with zero visible entries (e.g. "Play" at
  // tenant scope) hide entirely to keep the rail tight.
  // The middle slot is a flex-1 + min-h-0 + overflow-y-auto scroller
  // so when project scope shows the full tree (Workspace, Site,
  // Design, Rules, Play, Quality, Commerce, Collaborate, Help, Admin
  // — easily 30+ entries when expanded) the user can scroll without
  // losing the Menu header at the top or Settings pinned at the bottom.
  return (
    <nav className="flex h-full w-56 flex-col border-r border-ink-700 bg-ink-900 py-3">
      <div className="flex shrink-0 items-center justify-between px-2 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-500">
          Menu
        </span>
        <ExpandToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      </div>
      <div className="mx-2 mb-1 h-px shrink-0 bg-ink-800" />
      <div className="sidebar-scroll flex flex-1 min-h-0 flex-col gap-0.5 overflow-y-auto pb-1">
        {grouped.map(({ group, entries }) => {
          if (entries.length === 0) return null;
          // Settings lives at the bottom by convention — pull it out
          // of its group so it always sits below everything else.
          const nonSettings = entries.filter((s) => s.view !== "settings");
          if (nonSettings.length === 0) return null;
          const open = isGroupOpen(group);
          return (
            <div key={group.id} className="mt-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.id, open)}
                className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-500 hover:text-ink-300"
              >
                <span>{group.label}</span>
                <Caret open={open} />
              </button>
              {open && (
                <div className="flex flex-col gap-0.5 px-1">
                  {nonSettings.map(renderEntry)}
                </div>
              )}
            </div>
          );
        })}
        {fallback.filter((s) => s.view !== "settings").length > 0 && (
          <div className="mt-1">
            <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-500">
              Other
            </p>
            <div className="flex flex-col gap-0.5 px-1">
              {fallback.filter((s) => s.view !== "settings").map(renderEntry)}
            </div>
          </div>
        )}
      </div>
      <div className="mx-2 mb-1 mt-1 h-px shrink-0 bg-ink-800" />
      <div className="flex shrink-0 flex-col gap-0.5 px-1">
        {visible.filter((n) => n.view === "settings").map(renderEntry)}
      </div>
    </nav>
  );
}

/** Sidebar expand/collapse toggle. The icon rotates on state change
 *  so the affordance is unambiguous in both modes. */
function ExpandToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? "Collapse sidebar" : "Expand sidebar"}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-400 hover:bg-ink-800 hover:text-ink-100"
    >
      <svg
        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M5 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavButton({
  icon,
  label,
  active,
  disabled,
  expanded,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  /** Expanded mode shows the label inline; collapsed renders icon-only. */
  expanded?: boolean;
  onClick: () => void;
}) {
  // Expanded variant — wider, label visible, no tooltip needed since
  // the text is right there. Collapsed variant keeps the original
  // 40×40 square so the rail stays the historical 56px wide.
  if (expanded) {
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className={[
          "relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs transition-colors",
          active
            ? "bg-accent-500/15 text-accent-300"
            : disabled
              ? "text-ink-600"
              : "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
        ].join(" ")}
      >
        {active && (
          <span className="absolute -left-1 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent-500" />
        )}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      className={[
        "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-accent-500/15 text-accent-300"
          : disabled
          ? "text-ink-600"
          : "text-ink-400 hover:bg-ink-800 hover:text-ink-100",
      ].join(" ")}
    >
      {active && (
        <span className="absolute -left-2 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-accent-500" />
      )}
      {icon}
    </button>
  );
}

/* ----- icons ----- */
const ico = "h-4 w-4";

function DashboardIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="3" rx="1" />
      <rect x="9" y="7" width="5" height="7" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}
function ProjectsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" />
    </svg>
  );
}
function CardTypesIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3" width="6" height="9" rx="1" />
      <rect x="7.5" y="4" width="6" height="9" rx="1" opacity="0.6" />
    </svg>
  );
}
function CardsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="10" height="10" rx="1" />
      <path d="M6 6h4M6 9h4M6 11h2" />
    </svg>
  );
}
function AssetsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="7" r="1" />
      <path d="M2 12l4-3 4 2 4-3" />
    </svg>
  );
}
function RulesIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2.5" width="10" height="11" rx="1" />
      <path d="M5 5h6M5 8h6M5 11h4" />
    </svg>
  );
}
function SetsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5l5-2 5 2v6l-5 2-5-2V5z" />
      <path d="M3 5l5 2 5-2M8 7v6" />
    </svg>
  );
}
function FactionsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 13V3l5 2 5-2v10" />
      <path d="M3 8l5 2 5-2" />
    </svg>
  );
}
function LoreIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3.5h7a2 2 0 0 1 2 2V13H5a2 2 0 0 1-2-2V3.5z" />
      <path d="M3 11a2 2 0 0 1 2-2h7" />
      <path d="M6 6h4M6 8.5h3" />
    </svg>
  );
}
function PlaytestIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 4l7 4-7 4V4z" />
    </svg>
  );
}
function DecksIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2.5" width="7" height="10" rx="1.5" />
      <rect x="6" y="3.5" width="7" height="10" rx="1.5" />
    </svg>
  );
}
function BoardIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 8h12M8 3v10" />
    </svg>
  );
}
function RulesetsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h12M2 12h8" />
      <circle cx="13.5" cy="12" r="1.25" fill="currentColor" />
    </svg>
  );
}
function AbilitiesIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="3.5" cy="4" r="1.5" />
      <circle cx="12.5" cy="4" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <path d="M5 4h6M4.5 5.5L7 10.5M11.5 5.5L9 10.5" />
    </svg>
  );
}
function InsightsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 13V8M7.5 13V5M12 13V10" />
      <path d="M2 13.5h12" />
    </svg>
  );
}
function ValidationIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1.5L13.5 4v4.5c0 3.5-2.5 5.5-5.5 6.5-3-1-5.5-3-5.5-6.5V4L8 1.5z" />
      <path d="M5.5 8.5L7 10l3.5-3.5" />
    </svg>
  );
}
function BadgesIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1l1.7 2.4 2.9-.7-.6 2.9L14.5 7l-2.5 1.4.6 2.9-2.9-.7L8 13l-1.7-2.4-2.9.7.6-2.9L1.5 7l2.5-1.4-.6-2.9 2.9.7L8 1z" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" />
    </svg>
  );
}
function CmsIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 5.5h12" />
      <circle cx="3.5" cy="4.25" r="0.4" fill="currentColor" />
      <circle cx="4.75" cy="4.25" r="0.4" fill="currentColor" />
      <path d="M4 8h5M4 10h7" />
    </svg>
  );
}
function MarketplaceIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 4.5L3.5 2.5h9l1 2v1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1-3 0V4.5z" />
      <path d="M3 6.5v6.5h10V6.5" />
      <path d="M6.5 13v-3.5h3V13" />
    </svg>
  );
}
function PlatformIcon() {
  // Concentric / "control plane" mark — distinct from the tenant
  // and project icons so platform admins can spot it at a glance.
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CommerceIcon() {
  // Storefront mark — a price tag. Distinct from the marketplace
  // shop icon so users don't confuse "sell my creations" with
  // "browse the platform marketplace".
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8.5 2.5l5 5-6 6-5-5V3l1-1z" strokeLinejoin="round" />
      <circle cx="5.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
function MembersIcon() {
  // Two-person silhouette — universal "people / members" affordance.
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="2.5" />
      <path d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5" strokeLinecap="round" />
      <circle cx="11" cy="7" r="2" />
      <path d="M10 13c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5" strokeLinecap="round" />
    </svg>
  );
}
function SupportIcon() {
  // Question-mark-in-circle. Universal "Help / Support" affordance.
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6.2c0-1.1.9-2 2-2s2 .9 2 2c0 1.1-2 1.4-2 2.6" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function TasksIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5 5.5l1 1L8 5M5 9.5l1 1L8 9" />
      <path d="M9.5 6h2.5M9.5 10h2.5" />
    </svg>
  );
}
function MessagesIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7l-3 2.5V10.5a2 2 0 0 1-1.5-1.94V4.5z" />
      <path d="M5.5 6.5h5M5.5 8h3" />
    </svg>
  );
}
function PlanningIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M5 2.5v2M11 2.5v2" />
      <path d="M9 9l2 1.5L9 12" />
    </svg>
  );
}
