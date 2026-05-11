/**
 * Members view — dedicated user management surface, level-aware.
 *
 * Lifts the per-level membership + RBAC sections out of Settings so
 * users can find them as a first-class destination. Each level
 * shows the matching list:
 *
 *   • Platform — Platform admins + Roles & permissions
 *     (PlatformAdminsSection, PlatformRolesSection)
 *   • Tenant   — Workspace members
 *     (MembersSection)
 *   • Project  — Project members
 *     (ProjectMembersSection)
 *
 * The SettingsView still embeds the same sections so existing
 * deep-links don't break, but Members in the sidebar is the
 * canonical entry point.
 */

import { selectNavLevel, useDesigner } from "@/store/designerStore";
import {
  MembersSection,
  PlatformAdminsSection,
  PlatformRolesSection,
  ProjectMembersSection,
} from "@/components/SettingsView";

export function MembersView() {
  const navLevel = useDesigner(selectNavLevel);
  const platformRole = useDesigner((s) => s.platformRole);

  if (navLevel === "platform") {
    return (
      <div className="h-full overflow-y-auto bg-ink-950">
        <div className="mx-auto max-w-3xl space-y-6 p-8">
          <header>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">Platform</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-50">Members & roles</h1>
            <p className="mt-1 text-xs text-ink-400">
              Platform admins manage access to the cross-tenant surface here. Custom
              roles let you grant fine-grained permission slices instead of
              everything-or-nothing.
            </p>
          </header>
          {platformRole && <PlatformAdminsSection callerRole={platformRole} />}
          {platformRole && <PlatformRolesSection callerRole={platformRole} />}
          {!platformRole && (
            <p className="rounded border border-ink-800 bg-ink-900 p-4 text-xs text-ink-400">
              You need a platform role to manage platform admins.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (navLevel === "project") {
    return (
      <div className="h-full overflow-y-auto bg-ink-950">
        <div className="mx-auto max-w-3xl space-y-6 p-8">
          <header>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">Project</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-50">Project members</h1>
            <p className="mt-1 text-xs text-ink-400">
              Users who can sign in to this project. Independent of tenant
              membership — a tenant member without a row here can't open this
              project's editor.
            </p>
          </header>
          <ProjectMembersSection />
        </div>
      </div>
    );
  }

  // Tenant scope (default).
  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-3xl space-y-6 p-8">
        <header>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">Members</h1>
          <p className="mt-1 text-xs text-ink-400">
            People in this workspace. Project access is granted separately —
            tenant role does NOT confer project login.
          </p>
        </header>
        <MembersSection />
      </div>
    </div>
  );
}
