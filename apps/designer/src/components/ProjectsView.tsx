import { useState } from "react";
import { useDesigner } from "@/store/designerStore";
import { getRootDomain } from "@/lib/api";
import type { Project } from "@/lib/apiTypes";
import { useContextMenu } from "@/components/ContextMenu";
import { ProjectWizard } from "@/components/ProjectWizard";

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
  const tenants = useDesigner((s) => s.tenants);
  const activeTenantSlug = useDesigner((s) => s.activeTenantSlug);
  const selectProject = useDesigner((s) => s.selectProject);
  const setView = useDesigner((s) => s.setView);
  const deleteProject = useDesigner((s) => s.deleteProject);

  const tenant = tenants.find((t) => t.slug === activeTenantSlug);

  /**
   * Open a project. The "right" thing depends on context:
   *   • If we're already on the project's host, just select it
   *     locally (cheap; no full reload).
   *   • Otherwise, hard-navigate to the project's subdomain so the
   *     designer's Sidebar flips into project-scope mode and only
   *     card-design tools are visible.
   *
   * We pick the hyphen form (`<project>-<tenant>.<root>`) for the URL
   * because it's the user's preferred convention and survives a single
   * wildcard cert in production. The dot form still works server-side,
   * so users with a different preference can switch the URL by hand.
   */
  function openProject(p: Project) {
    if (!tenant) return;
    const root = getRootDomain();
    const port = window.location.port ? `:${window.location.port}` : "";
    // /admin path because the project's subdomain root now serves the
    // tenant's public CMS site (sec: every tenant has their own CMS).
    // The designer for the project lives at /admin.
    const target = `${window.location.protocol}//${p.slug}-${tenant.slug}.${root}${port}/admin`;
    // Persist the project selection in the store first so the new
    // page's loadInitial sees it as the prior preference; the host
    // resolver overrides it anyway, but this keeps the auth token /
    // session continuous.
    void selectProject(p.id).then(() => {
      window.location.href = target;
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Tenant</p>
          <h1 className="mt-1 text-xl font-semibold text-ink-50">Projects</h1>
          <p className="mt-1 text-xs text-ink-400">
            Each project is a card game. Open one to enter its card-design
            workspace — the sidebar will switch to show card types, cards,
            assets, sets, and the rest of the production tools.
          </p>
        </header>

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          <NewProjectTile />
          {projects.map((p) => (
            <ProjectTile
              key={p.id}
              project={p}
              isActive={p.id === activeProjectId}
              onOpen={() => openProject(p)}
              onPreviewLocally={async () => {
                // Fallback when the user is on a custom domain or otherwise
                // can't navigate to the canonical project subdomain — at
                // least pick the project so the rest of the app reflects it.
                await selectProject(p.id);
                setView("dashboard");
              }}
              onDelete={() => {
                if (confirm(`Delete project "${p.name}"?\nThis removes all card types, cards, and assets in it.`)) {
                  void deleteProject(p.id);
                }
              }}
            />
          ))}
        </ul>

        {projects.length === 0 && (
          <p className="mt-6 text-sm text-ink-500">
            No projects yet — create your first one above.
          </p>
        )}
      </div>
    </div>
  );
}

function ProjectTile({
  project,
  isActive,
  onOpen,
  onPreviewLocally,
  onDelete,
}: {
  project: Project;
  isActive: boolean;
  onOpen: () => void;
  onPreviewLocally: () => void;
  onDelete: () => void;
}) {
  const ctx = useContextMenu(() => [
    { label: "Open project", onSelect: onOpen },
    {
      label: "Quick-select (no navigate)",
      onSelect: onPreviewLocally,
    },
    { separator: true },
    {
      label: "Copy project id",
      onSelect: () => {
        void navigator.clipboard.writeText(project.id);
      },
    },
    { separator: true },
    {
      label: "Delete project",
      onSelect: onDelete,
      danger: true,
    },
  ]);
  return (
    <li
      onContextMenu={ctx.onContextMenu}
      className={[
        "group flex flex-col overflow-hidden rounded-lg border bg-ink-900 transition-colors hover:border-accent-500/40",
        isActive ? "border-accent-500/50 ring-1 ring-accent-500/30" : "border-ink-700",
      ].join(" ")}
    >
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-2 p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink-50">{project.name}</h3>
            <p className="truncate font-mono text-[10px] text-ink-500">{project.slug}</p>
          </div>
          <StatusPill status={project.status} />
        </div>
        {project.description && (
          <p className="line-clamp-3 text-[11px] leading-snug text-ink-400">
            {project.description}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-500">
          <span>v{project.version}</span>
          <span>·</span>
          <span>updated {formatRelative(project.updatedAt)}</span>
          {isActive && (
            <span className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
              active
            </span>
          )}
        </div>
      </button>
      <div className="flex border-t border-ink-800">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          Open
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500"
        >
          Delete
        </button>
      </div>
      {ctx.element}
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    idea: "border-ink-700 bg-ink-800 text-ink-400",
    draft: "border-ink-700 bg-ink-800 text-ink-400",
    prototype: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    playtesting: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    production: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    released: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    archived: "border-ink-700 bg-ink-800 text-ink-600",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
        map[status] ?? map.draft
      }`}
    >
      {status}
    </span>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ---------------------------------------------------------------------- */
/* + new tile                                                             */
/* ---------------------------------------------------------------------- */

/**
 * "+ New project" launcher tile. Toggles the multi-step wizard on
 * click — the wizard handles the actual create flow including theme,
 * owner email, and the auto-seeded landing page.
 */
function NewProjectTile() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-full min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300"
        >
          <PlusIcon />
          <span className="text-xs font-medium">New project</span>
          <span className="text-[10px] text-ink-500">Saga, Spell Forge, …</span>
        </button>
      </li>
    );
  }

  // The wizard is wider than a single grid tile, so we span the
  // whole row (`col-span-full`) when active. Saves the user from
  // tunneling through a tiny tile and gives the multi-step form the
  // breathing room it needs.
  return (
    <li className="col-span-full">
      <ProjectWizard onClose={() => setOpen(false)} />
    </li>
  );
}

function PlusIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
