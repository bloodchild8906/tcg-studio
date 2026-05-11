import { useCallback, useEffect, useState } from "react";
import {
  selectActiveProject,
  selectNavLevel,
  useDesigner,
} from "@/store/designerStore";
import {
  apiHealth,
  assetBlobUrl,
  createPlatformRole,
  deletePlatformRole,
  grantPlatformAdmin,
  inviteMember,
  inviteProjectMember,
  listMemberships,
  listPlatformAdmins,
  listPlatformPermissions,
  listPlatformRoles,
  listProjectMembers,
  removeMembership,
  removeProjectMember,
  revokePlatformAdmin,
  updateMembershipRole,
  updatePlatformRole,
  updateProjectMemberRole,
  updateTenant,
} from "@/lib/api";
import type { PermissionDef, PlatformAdminRow, RoleRow } from "@/lib/api";
import type {
  ProjectMember,
  Tenant,
  TenantMember,
} from "@/lib/apiTypes";
import { useAssetPicker } from "@/components/AssetPicker";
import { TenantWizard } from "@/components/TenantWizard";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";
import { AuditLogSection } from "@/components/settings/AuditLogSection";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { WebhooksSection } from "@/components/settings/WebhooksSection";
import { JobsSection } from "@/components/settings/JobsSection";
import { BillingSection } from "@/components/settings/BillingSection";
import { LocalizationSection } from "@/components/settings/LocalizationSection";

/**
 * Settings view — tenant-scoped workspace management.
 *
 * The user wanted "everything of the tenant to be only inside the tenant",
 * so the cross-tenant browse that used to live in the sidebar is gone. This
 * view operates against the *current* tenant: rename, change status, view
 * connection details. Switching to another tenant lives at the bottom (a
 * less-prominent "Workspaces" section), and creating a new one is a deliberate
 * action behind a small button.
 *
 * Layout, top to bottom:
 *   1. This workspace — current tenant card with editable fields.
 *   2. API connection — read-only base URL + active slug.
 *   3. Other workspaces — collapsed list of every accessible tenant with
 *      Switch buttons. "+ New workspace" button creates one.
 *   4. Danger zone — delete current tenant (cascades).
 */
/**
 * Per the capability matrix:
 *   • Platform — manage tenants, payments, super-admin stuff. Account
 *     + theme + system info, with the heavy lifting on the dedicated
 *     PlatformView. No tenant management here at platform scope
 *     because there's no "active tenant" to manage.
 *   • Tenant — manage the tenant: members, brand, billing,
 *     localization, domains, plugins, API keys, webhooks, audit, etc.
 *     Plus a tenant-level theme.
 *   • Project — manage ONLY this project. Project members and a
 *     project-level theme. No tenant management, no peek at other
 *     tenants, no platform settings. Projects are isolated.
 *
 * The Settings entry-point is gated by the host level via
 * `selectNavLevel` so each scope sees only sections that belong to it.
 */
export function SettingsView() {
  const navLevel = useDesigner(selectNavLevel);
  const platformRole = useDesigner((s) => s.platformRole);

  if (navLevel === "platform") {
    return (
      <div className="h-full overflow-y-auto bg-ink-950">
        <div className="mx-auto max-w-3xl space-y-6 p-8">
          <header>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">Platform</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink-50">Settings</h1>
            <p className="mt-1 text-xs text-ink-400">
              System-wide configuration. Manage admins + roles in the Members
              view; manage tenants, billing, and announcements in Platform
              admin; install themes from the Marketplace.
            </p>
          </header>
          <AccountSection />
          <ApiInfo />
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
            <h1 className="mt-1 text-2xl font-semibold text-ink-50">Settings</h1>
            <p className="mt-1 text-xs text-ink-400">
              Project-only settings. Manage members in Members, commerce in
              Commerce, plugins + themes in Marketplace.
            </p>
          </header>
          <AccountSection />
          <ProjectEmailProviderSection />
          <ProjectStorageProviderSection />
          <ApiInfo />
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
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">Settings</h1>
          <p className="mt-1 text-xs text-ink-400">
            Configure brand, billing, providers, domains, and connection
            details. Manage members in the Members view.
          </p>
        </header>

        <AccountSection />
        <CurrentWorkspace />
        <BrandSection />
        <BillingSection />
        <EmailProviderSection />
        <LocalizationSection />
        <DomainsSection />
        <PublicGallerySection />
        <ApiKeysSection />
        <WebhooksSection />
        <PluginsSection />
        <JobsSection />
        <AuditLogSection />
        <ApiInfo />
        <OtherWorkspaces />
        <DangerZone />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Account (auth)                                                         */
/* ---------------------------------------------------------------------- */

function AccountSection() {
  const currentUser = useDesigner((s) => s.currentUser);
  const memberships = useDesigner((s) => s.memberships);
  const signOut = useDesigner((s) => s.signOut);

  if (!currentUser) {
    return (
      <Section title="Account" subtitle="not signed in">
        <p className="text-[11px] text-ink-500">
          Sign in to bind your changes to a real user. Until you do, anyone with
          the tenant slug can hit the API and act as you.
        </p>
        <AuthForm />
      </Section>
    );
  }

  return (
    <Section title="Account" subtitle="signed in">
      <FieldRow label="Email">
        <Code>{currentUser.email}</Code>
      </FieldRow>
      <FieldRow label="Name">
        <Code>{currentUser.name}</Code>
      </FieldRow>
      <FieldRow label="User ID">
        <Code>{currentUser.id}</Code>
      </FieldRow>
      <FieldRow label="Memberships">
        <ul className="space-y-1 rounded border border-ink-800 bg-ink-900/40 p-2">
          {memberships.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="text-ink-200">{m.tenant.name}</span>
              <span className="text-ink-500">
                <code className="font-mono">{m.tenant.slug}</code> · {m.role}
              </span>
            </li>
          ))}
          {memberships.length === 0 && (
            <li className="text-[11px] text-ink-500">No memberships yet.</li>
          )}
        </ul>
      </FieldRow>
      <div className="flex justify-end border-t border-ink-800 pt-3">
        <button
          type="button"
          onClick={signOut}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
        >
          Sign out
        </button>
      </div>
    </Section>
  );
}

function AuthForm() {
  const signIn = useDesigner((s) => s.signIn);
  const signUp = useDesigner((s) => s.signUp);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn({ email, password });
      } else {
        await signUp({ email, password, name });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded border border-ink-800 bg-ink-900/40 p-3">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={[
            "flex-1 rounded px-2 py-1 text-[11px] uppercase tracking-wider",
            mode === "signin"
              ? "bg-accent-500/15 text-accent-300"
              : "text-ink-400 hover:bg-ink-800",
          ].join(" ")}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={[
            "flex-1 rounded px-2 py-1 text-[11px] uppercase tracking-wider",
            mode === "signup"
              ? "bg-accent-500/15 text-accent-300"
              : "text-ink-400 hover:bg-ink-800",
          ].join(" ")}
        >
          Sign up
        </button>
      </div>
      {mode === "signup" && (
        <FieldRow label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
      )}
      <FieldRow label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete={mode === "signin" ? "email" : "email"}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
      </FieldRow>
      <FieldRow label="Password" hint="Min 8 characters.">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={mode === "signup" ? 8 : 1}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
      </FieldRow>
      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-ink-500">
          {mode === "signup"
            ? "We'll auto-create a personal workspace for you."
            : "Sign in to an existing account."}
        </p>
        <button
          type="submit"
          disabled={busy || !email || !password || (mode === "signup" && !name)}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
        >
          {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Current workspace                                                      */
/* ---------------------------------------------------------------------- */

function CurrentWorkspace() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;

  const [name, setName] = useState(tenant?.name ?? "");
  const [status, setStatus] = useState(tenant?.status ?? "active");
  const [tenantType, setTenantType] = useState<string>(
    tenant?.tenantType ?? "studio",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  // Reset when the active tenant changes (switch workspace).
  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name);
    setStatus(tenant.status);
    setTenantType(tenant.tenantType ?? "studio");
  }, [tenant?.id, tenant?.name, tenant?.status, tenant?.tenantType]);

  if (!tenant) {
    return (
      <Section title="This workspace">
        <p className="text-xs text-ink-500">No active tenant. Pick or create one below.</p>
      </Section>
    );
  }

  const dirty =
    name !== tenant.name ||
    status !== tenant.status ||
    tenantType !== (tenant.tenantType ?? "studio");

  async function save() {
    if (!tenant || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTenant(tenant.id, {
        name,
        status,
        tenantType: tenantType as
          | "solo"
          | "studio"
          | "publisher"
          | "school"
          | "reseller",
      });
      // Update the local tenants array so the header / picker reflect it.
      useDesigner.setState((s) => ({
        tenants: s.tenants.map((t) => (t.id === updated.id ? updated : t)),
      }));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="This workspace">
      <FieldRow label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        />
      </FieldRow>
      <FieldRow label="Slug" hint="Cannot be changed in this UI; lives in the API headers and URL prefixes.">
        <Code>{tenant.slug}</Code>
      </FieldRow>
      <FieldRow label="Tenant ID" hint="Stable identifier for API calls.">
        <Code>{tenant.id}</Code>
      </FieldRow>
      <FieldRow label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        >
          {[
            "trial",
            "active",
            "past_due",
            "suspended",
            "disabled",
            "pending_deletion",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        label="Workspace type"
        hint="Drives the dashboard preset + the suggested next-step prompts."
      >
        <select
          value={tenantType}
          onChange={(e) => setTenantType(e.target.value)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        >
          <option value="solo">Solo creator</option>
          <option value="studio">Indie studio</option>
          <option value="publisher">Publisher / multi-game</option>
          <option value="school">School / classroom</option>
          <option value="reseller">Reseller / white-label host</option>
        </select>
      </FieldRow>

      <div className="flex items-center justify-end gap-2 border-t border-ink-800 pt-3">
        {error && <span className="mr-auto text-[11px] text-danger-500">{error}</span>}
        {savedTick && (
          <span className="mr-auto text-[11px] text-emerald-300">Saved.</span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* Members                                                                */
/* ---------------------------------------------------------------------- */

const ROLE_OPTIONS = [
  "tenant_owner",
  "tenant_admin",
  "billing_admin",
  "brand_manager",
  "domain_manager",
  "plugin_manager",
  "security_admin",
  "audit_viewer",
  "project_creator",
  "viewer",
] as const;

export function MembersSection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const currentUser = useDesigner((s) => s.currentUser);

  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      setMembers(await listMemberships());
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!tenant) return null;

  return (
    <Section title="Members" subtitle={`${members.length}`}>
      <p className="text-[11px] text-ink-500">
        Members of <code className="font-mono">{tenant.slug}</code>. Invitees must already
        have a TCGStudio account — magic-link invites land in a future iteration.
      </p>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500">
          {error}
        </p>
      )}

      <ul className="divide-y divide-ink-800 rounded border border-ink-800">
        {loading && members.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">Loading…</li>
        ) : members.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">No members yet.</li>
        ) : (
          members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isSelf={currentUser?.id === m.userId}
              onRoleChange={async (role) => {
                try {
                  const updated = await updateMembershipRole(m.id, role);
                  setMembers((prev) =>
                    prev.map((x) => (x.id === updated.id ? updated : x)),
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : "role change failed");
                }
              }}
              onRemove={async () => {
                if (!confirm(`Remove ${m.user.email} from this tenant?`)) return;
                try {
                  await removeMembership(m.id);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "remove failed");
                }
              }}
            />
          ))
        )}
      </ul>

      <InviteForm
        onInvited={(member) => setMembers((prev) => [...prev, member])}
        onError={setError}
      />
    </Section>
  );
}

function MemberRow({
  member,
  isSelf,
  onRoleChange,
  onRemove,
}: {
  member: TenantMember;
  isSelf: boolean;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 font-medium uppercase text-ink-300">
        {member.user.name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-100">
          {member.user.name}
          {isSelf && (
            <span className="ml-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[9px] uppercase tracking-wider text-emerald-300">
              you
            </span>
          )}
        </p>
        <p className="truncate text-[10px] text-ink-500">{member.user.email}</p>
      </div>
      <select
        value={member.role}
        onChange={(e) => onRoleChange(e.target.value)}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        title="Remove member"
        className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-400 hover:bg-danger-500/10 hover:text-danger-500"
      >
        ×
      </button>
    </li>
  );
}

function InviteForm({
  onInvited,
  onError,
}: {
  onInvited: (m: TenantMember) => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("viewer");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    onError("");
    try {
      const m = await inviteMember({ email: email.trim().toLowerCase(), role });
      onInvited(m);
      setEmail("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-[1fr_140px_auto] items-center gap-2 border-t border-ink-800 pt-3"
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="someone@example.com"
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as (typeof ROLE_OPTIONS)[number])}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
      >
        {busy ? "…" : "Invite"}
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Project Members                                                        */
/* ---------------------------------------------------------------------- */

const PROJECT_ROLE_OPTIONS = [
  "project_owner",
  "project_admin",
  "game_designer",
  "card_designer",
  "template_designer",
  "rules_designer",
  "ability_designer",
  "artist",
  "writer",
  "set_manager",
  "export_manager",
  "playtester",
  "viewer",
] as const;

/**
 * Project-scoped member list. Visible at project scope only — at
 * tenant scope there's no "active project" to manage members of, so
 * we hide the section. Each project owns its own membership table
 * (sec 13.4); these rows are independent of the tenant-level
 * memberships rendered above. Tenant admins can still manage these
 * via the route-layer bypass.
 */
export function ProjectMembersSection() {
  const projects = useDesigner((s) => s.projects);
  const activeProjectId = useDesigner((s) => s.activeProjectId);
  const navLevel = useDesigner(selectNavLevel);
  const project = projects.find((p) => p.id === activeProjectId) ?? null;

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      setMembers(await listProjectMembers(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Only render at project scope; at the tenant level there's no
  // active project and the section would be empty / confusing.
  if (navLevel !== "project" || !project) return null;

  return (
    <Section
      title="Project members"
      subtitle={`${project.name} · ${members.length}`}
    >
      <p className="text-[11px] text-ink-500">
        These users can sign in to <code className="font-mono">{project.slug}</code>.
        Project membership is independent of tenant membership: a tenant member without
        a row here can't open this project's editor. Tenant owners and admins can still
        manage everything via their tenant role.
      </p>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500">
          {error}
        </p>
      )}

      <ul className="divide-y divide-ink-800 rounded border border-ink-800">
        {loading && members.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">Loading…</li>
        ) : members.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">No members yet.</li>
        ) : (
          members.map((m) => (
            <ProjectMemberRow
              key={m.id}
              member={m}
              onRoleChange={async (role) => {
                try {
                  const updated = await updateProjectMemberRole(
                    project.id,
                    m.id,
                    role,
                  );
                  setMembers((prev) =>
                    prev.map((x) => (x.id === updated.id ? updated : x)),
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : "role change failed");
                }
              }}
              onRemove={async () => {
                if (!confirm(`Remove ${m.user.email} from this project?`)) return;
                try {
                  await removeProjectMember(project.id, m.id);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "remove failed");
                }
              }}
            />
          ))
        )}
      </ul>

      <ProjectInviteForm
        projectId={project.id}
        onInvited={(member) => setMembers((prev) => [...prev, member])}
        onError={setError}
      />
    </Section>
  );
}

function ProjectMemberRow({
  member,
  onRoleChange,
  onRemove,
}: {
  member: ProjectMember;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 font-medium uppercase text-ink-300">
        {member.user.name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-100">{member.user.name}</p>
        <p className="truncate text-[10px] text-ink-500">{member.user.email}</p>
      </div>
      <select
        value={member.role}
        onChange={(e) => onRoleChange(e.target.value)}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
      >
        {PROJECT_ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        title="Remove member"
        className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-400 hover:bg-danger-500/10 hover:text-danger-500"
      >
        ×
      </button>
    </li>
  );
}

function ProjectInviteForm({
  projectId,
  onInvited,
  onError,
}: {
  projectId: string;
  onInvited: (m: ProjectMember) => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof PROJECT_ROLE_OPTIONS)[number]>("game_designer");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    onError("");
    try {
      const m = await inviteProjectMember(projectId, {
        email: email.trim().toLowerCase(),
        role,
      });
      onInvited(m);
      setEmail("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-[1fr_140px_auto] items-center gap-2 border-t border-ink-800 pt-3"
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="someone@example.com (must be tenant member first)"
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
      />
      <select
        value={role}
        onChange={(e) =>
          setRole(e.target.value as (typeof PROJECT_ROLE_OPTIONS)[number])
        }
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
      >
        {PROJECT_ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
      >
        {busy ? "…" : "Invite"}
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Per-level theme editors — REMOVED                                      */
/* ---------------------------------------------------------------------- */
//
// Theme tokens (accent, density, layout) flow through the Marketplace
// → Themes install side-effect (`lib/marketplace.ts → cms_theme`
// handler), not a manual editor in Settings. The user explicitly
// asked to remove the manual UI: install a theme to apply it, submit
// a theme to add a new one. The schema fields
// (PlatformSetting.brandingJson, Tenant.brandingJson,
// Project.brandingJson) and the GET/PUT endpoints stay because the
// install handler writes through them — the manual UI was redundant.

/* ---------------------------------------------------------------------- */
/* Platform admins (super-admin RBAC)                                     */
/* ---------------------------------------------------------------------- */

const PLATFORM_ROLE_OPTIONS = ["owner", "admin", "support"] as const;

/**
 * Manage who can access the platform-admin surface. Mirrors the
 * tenant `MembersSection` pattern so the UX is consistent across
 * levels. The platform-role hierarchy is owner > admin > support;
 * `support` is read-only and can't grant or revoke other admins.
 */
export function PlatformAdminsSection({
  callerRole,
}: {
  callerRole: "owner" | "admin" | "support";
}) {
  const currentUser = useDesigner((s) => s.currentUser);
  const [admins, setAdmins] = useState<PlatformAdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canMutate = callerRole === "owner" || callerRole === "admin";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAdmins(await listPlatformAdmins());
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Section title="Platform admins" subtitle={`${admins.length}`}>
      <p className="text-[11px] text-ink-500">
        Users with a non-null platform role get access to the Platform admin view —
        cross-tenant tenant management, billing, and announcements. This identity
        is independent of any tenant or project membership.
      </p>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500">
          {error}
        </p>
      )}

      <ul className="divide-y divide-ink-800 rounded border border-ink-800">
        {loading && admins.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">Loading…</li>
        ) : admins.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">No admins yet.</li>
        ) : (
          admins.map((a) => (
            <PlatformAdminRowItem
              key={a.id}
              admin={a}
              isSelf={currentUser?.id === a.id}
              canMutate={canMutate}
              callerRole={callerRole}
              onRevoke={async () => {
                if (!confirm(`Revoke platform access for ${a.email}?`)) return;
                try {
                  await revokePlatformAdmin(a.id);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "revoke failed");
                }
              }}
            />
          ))
        )}
      </ul>

      {canMutate && (
        <PlatformAdminGrantForm
          callerRole={callerRole}
          onGranted={(admin) =>
            setAdmins((prev) => {
              const without = prev.filter((x) => x.id !== admin.id);
              return [...without, admin].sort((a, b) =>
                a.email.localeCompare(b.email),
              );
            })
          }
          onError={setError}
        />
      )}
    </Section>
  );
}

function PlatformAdminRowItem({
  admin,
  isSelf,
  canMutate,
  callerRole,
  onRevoke,
}: {
  admin: PlatformAdminRow;
  isSelf: boolean;
  canMutate: boolean;
  callerRole: "owner" | "admin" | "support";
  onRevoke: () => void;
}) {
  // Admins can't revoke owners — only owners can. Surface that as a
  // disabled button so the rules are visible rather than mysterious.
  const cantRevokeOwner = admin.platformRole === "owner" && callerRole !== "owner";
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 font-medium uppercase text-ink-300">
        {admin.name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-100">
          {admin.name}
          {isSelf && (
            <span className="ml-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[9px] uppercase tracking-wider text-emerald-300">
              you
            </span>
          )}
        </p>
        <p className="truncate text-[10px] text-ink-500">{admin.email}</p>
      </div>
      <span className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] font-mono text-ink-200">
        {admin.platformRole}
      </span>
      <button
        type="button"
        onClick={onRevoke}
        disabled={!canMutate || cantRevokeOwner}
        title={
          cantRevokeOwner
            ? "Only owners can revoke owners"
            : !canMutate
              ? "Need owner or admin role to revoke"
              : "Revoke platform access"
        }
        className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-400 hover:bg-danger-500/10 hover:text-danger-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400"
      >
        ×
      </button>
    </li>
  );
}

function PlatformAdminGrantForm({
  callerRole,
  onGranted,
  onError,
}: {
  callerRole: "owner" | "admin" | "support";
  onGranted: (a: PlatformAdminRow) => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  // Default to "support" — the safest grant. Only owners can promote
  // to "owner" so we hide that option from non-owners.
  const [role, setRole] = useState<"owner" | "admin" | "support">("support");
  const [busy, setBusy] = useState(false);

  const allowedRoles = PLATFORM_ROLE_OPTIONS.filter(
    (r) => r !== "owner" || callerRole === "owner",
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    onError("");
    try {
      const a = await grantPlatformAdmin({
        email: email.trim().toLowerCase(),
        role,
      });
      onGranted(a);
      setEmail("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "grant failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-[1fr_120px_auto] items-center gap-2 border-t border-ink-800 pt-3"
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="someone@example.com (must already have an account)"
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
      />
      <select
        value={role}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "owner" || v === "admin" || v === "support") setRole(v);
        }}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
      >
        {allowedRoles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
      >
        {busy ? "…" : "Grant"}
      </button>
    </form>
  );
}

// PlatformThemeSection / ProjectThemeSection removed — see note above.

/* ---------------------------------------------------------------------- */
/* Platform roles + permissions (real RBAC, sec 13)                       */
/* ---------------------------------------------------------------------- */

/**
 * Role list with permission picker. The Role table is the source of
 * truth for what a role grants — built-in roles are locked
 * (isSystem=true), custom roles can be created with any permission
 * subset. Lets platform admins go beyond the owner/admin/support
 * trio that was previously hardcoded.
 */
export function PlatformRolesSection({
  callerRole,
}: {
  callerRole: "owner" | "admin" | "support";
}) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canMutate = callerRole === "owner" || callerRole === "admin";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, c] = await Promise.all([
        listPlatformRoles(),
        listPlatformPermissions(),
      ]);
      setRoles(r);
      setCatalog(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveEdit(id: string, patch: { permissions?: string[]; description?: string; name?: string }) {
    try {
      const updated = await updatePlatformRole(id, patch);
      setRoles((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  async function deleteRole(id: string, name: string) {
    if (!confirm(`Delete custom role "${name}"? Users still holding it will be left without one.`))
      return;
    try {
      await deletePlatformRole(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <Section title="Roles & permissions" subtitle={`${roles.length}`}>
      <p className="text-[11px] text-ink-500">
        Platform roles control what each grant unlocks. Built-in roles ({" "}
        <code className="font-mono">owner</code>,{" "}
        <code className="font-mono">admin</code>,{" "}
        <code className="font-mono">support</code>) are locked; create
        custom roles for fine-grained delegation (e.g. a "Billing-only"
        role with just the billing permissions).
      </p>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {loading && roles.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">Loading…</li>
        ) : (
          roles.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              catalog={catalog}
              canMutate={canMutate}
              isEditing={editingId === r.id}
              onEdit={() => setEditingId(r.id)}
              onCancel={() => setEditingId(null)}
              onSave={(patch) => saveEdit(r.id, patch)}
              onDelete={() => deleteRole(r.id, r.name)}
            />
          ))
        )}
      </ul>

      {canMutate && (
        <div className="border-t border-ink-800 pt-3">
          {creating ? (
            <RoleCreateForm
              catalog={catalog}
              onCancel={() => setCreating(false)}
              onCreated={async (role) => {
                setRoles((prev) => [...prev, role]);
                setCreating(false);
              }}
              onError={setError}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25"
            >
              + New custom role
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function RoleCard({
  role,
  catalog,
  canMutate,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  role: RoleRow;
  catalog: PermissionDef[];
  canMutate: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: { permissions?: string[]; description?: string; name?: string }) => void;
  onDelete: () => void;
}) {
  const [draftPerms, setDraftPerms] = useState<Set<string>>(
    new Set(role.permissionsJson),
  );
  const [draftName, setDraftName] = useState(role.name);
  const [draftDescription, setDraftDescription] = useState(role.description);

  // Reset draft when entering edit mode so a half-edited cancel
  // doesn't leak into the next open.
  useEffect(() => {
    if (isEditing) {
      setDraftPerms(new Set(role.permissionsJson));
      setDraftName(role.name);
      setDraftDescription(role.description);
    }
  }, [isEditing, role.permissionsJson, role.name, role.description]);

  const grouped = catalog.reduce<Record<string, PermissionDef[]>>((acc, p) => {
    if (!acc[p.group]) acc[p.group] = [];
    acc[p.group].push(p);
    return acc;
  }, {});

  return (
    <li
      className={[
        "rounded border bg-ink-950 p-3",
        isEditing ? "border-accent-500/50" : "border-ink-800",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              disabled={role.isSystem}
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs font-semibold text-ink-100 disabled:opacity-60"
            />
          ) : (
            <p className="truncate text-xs font-semibold text-ink-100">
              {role.name}{" "}
              <span className="ml-1 font-mono text-[10px] text-ink-500">
                {role.slug}
              </span>
              {role.isSystem && (
                <span className="ml-1.5 rounded border border-ink-700 bg-ink-900 px-1.5 text-[9px] uppercase tracking-wider text-ink-400">
                  built-in
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isEditing && canMutate && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800"
              >
                Edit
              </button>
              {!role.isSystem && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-0.5 text-[10px] text-danger-300 hover:bg-danger-500/20"
                >
                  Delete
                </button>
              )}
            </>
          )}
          {isEditing && (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  onSave({
                    name: role.isSystem ? undefined : draftName,
                    description: draftDescription,
                    permissions: role.isSystem ? undefined : Array.from(draftPerms),
                  })
                }
                className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[10px] font-medium text-accent-300 hover:bg-accent-500/25"
              >
                Save
              </button>
            </>
          )}
        </div>
      </header>

      {isEditing ? (
        <textarea
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          rows={2}
          className="mt-2 w-full resize-none rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-200"
        />
      ) : (
        role.description && (
          <p className="mt-1 text-[11px] text-ink-400">{role.description}</p>
        )
      )}

      <div className="mt-2">
        <p className="text-[10px] uppercase tracking-wider text-ink-500">
          Permissions{" "}
          <span className="text-ink-400">
            ({(isEditing ? draftPerms.size : role.permissionsJson.length)})
          </span>
        </p>
        {isEditing && !role.isSystem ? (
          <PermissionPicker
            grouped={grouped}
            selected={draftPerms}
            onToggle={(key) => {
              setDraftPerms((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
          />
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {role.permissionsJson.map((p) => (
              <li
                key={p}
                className="rounded border border-ink-800 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-ink-300"
                title={catalog.find((c) => c.key === p)?.description ?? p}
              >
                {p}
              </li>
            ))}
          </ul>
        )}
        {isEditing && role.isSystem && (
          <p className="mt-1 text-[10px] text-ink-500">
            Built-in role — permissions are locked. Create a custom role to
            tailor the permission set.
          </p>
        )}
      </div>
    </li>
  );
}

function PermissionPicker({
  grouped,
  selected,
  onToggle,
}: {
  grouped: Record<string, PermissionDef[]>;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="mt-1 space-y-2">
      {Object.entries(grouped).map(([group, perms]) => (
        <div key={group} className="rounded border border-ink-800 bg-ink-900 p-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">
            {group}
          </p>
          <ul className="space-y-1">
            {perms.map((p) => (
              <li key={p.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(p.key)}
                  onChange={() => onToggle(p.key)}
                  className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer accent-accent-500"
                  id={`perm-${p.key}`}
                />
                <label
                  htmlFor={`perm-${p.key}`}
                  className="min-w-0 cursor-pointer text-[11px]"
                >
                  <span className="block text-ink-200">{p.label}</span>
                  <span className="block font-mono text-[9px] text-ink-500">
                    {p.key}
                  </span>
                  <span className="block text-[10px] text-ink-400">
                    {p.description}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RoleCreateForm({
  catalog,
  onCancel,
  onCreated,
  onError,
}: {
  catalog: PermissionDef[];
  onCancel: () => void;
  onCreated: (role: RoleRow) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const grouped = catalog.reduce<Record<string, PermissionDef[]>>((acc, p) => {
    if (!acc[p.group]) acc[p.group] = [];
    acc[p.group].push(p);
    return acc;
  }, {});

  function autoSlug(s: string) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    onError("");
    try {
      const role = await createPlatformRole({
        name: name.trim(),
        slug: (slug.trim() || autoSlug(name)) || "custom_role",
        description: description.trim() || undefined,
        permissions: Array.from(perms),
      });
      await onCreated(role);
    } catch (err) {
      onError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded border-2 border-dashed border-accent-500/40 bg-accent-500/5 p-3">
      <p className="text-[10px] uppercase tracking-wider text-accent-300">
        New custom role
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slug) setSlug(autoSlug(e.target.value));
          }}
          placeholder="Role name (e.g. Billing reviewer)"
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
        <input
          type="text"
          value={slug}
          onChange={(e) =>
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))
          }
          placeholder="slug"
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-100"
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="What does this role do? (shown to admins on the grant flow)"
        className="block w-full resize-none rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
      />
      <p className="text-[10px] uppercase tracking-wider text-ink-400">
        Pick permissions ({perms.size} selected)
      </p>
      <PermissionPicker
        grouped={grouped}
        selected={perms}
        onToggle={(key) => {
          setPerms((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        }}
      />
      <div className="flex items-center justify-end gap-2 border-t border-ink-800 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-ink-700 bg-ink-900 px-3 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create role"}
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/* Brand                                                                  */
/* ---------------------------------------------------------------------- */

function BrandSection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;

  const [productName, setProductName] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [logoAssetId, setLogoAssetId] = useState<string | null>(null);
  const [hidePlatformBranding, setHidePlatformBranding] = useState(false);
  const [supportEmail, setSupportEmail] = useState("");
  const [legalName, setLegalName] = useState("");
  const [membersAreaEnabled, setMembersAreaEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  // Project-scoped asset picker. The tenant logo lives on the tenant, but
  // the asset library itself is project-scoped (sec 20.3). The user picks
  // a logo from whichever project is active in the header. Future iteration:
  // an asset can be marked tenant-level and surface in a tenant-scoped picker.
  const picker = useAssetPicker((asset) => setLogoAssetId(asset.id));

  useEffect(() => {
    if (!tenant) return;
    const b = tenant.brandingJson ?? {};
    setProductName(typeof b.productName === "string" ? b.productName : "");
    setAccentColor(typeof b.accentColor === "string" ? b.accentColor : "");
    setLogoAssetId(typeof b.logoAssetId === "string" ? b.logoAssetId : null);
    setHidePlatformBranding(b.hidePlatformBranding === true);
    setSupportEmail(typeof b.supportEmail === "string" ? b.supportEmail : "");
    setLegalName(typeof b.legalName === "string" ? b.legalName : "");
    setMembersAreaEnabled(b.membersAreaEnabled === true);
  }, [tenant?.id, tenant?.updatedAt]);

  if (!tenant) return null;

  const original = tenant.brandingJson ?? {};
  const dirty =
    productName !== (original.productName ?? "") ||
    accentColor !== (original.accentColor ?? "") ||
    logoAssetId !== (typeof original.logoAssetId === "string" ? original.logoAssetId : null) ||
    hidePlatformBranding !== (original.hidePlatformBranding === true) ||
    supportEmail !== (original.supportEmail ?? "") ||
    legalName !== (original.legalName ?? "") ||
    membersAreaEnabled !== (original.membersAreaEnabled === true);

  async function save() {
    if (!tenant || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Merge so unknown branding fields (future / plugin-added) survive.
      const next = { ...(tenant.brandingJson ?? {}) };
      // Strip empty strings so they aren't persisted as junk.
      if (productName.trim()) next.productName = productName.trim();
      else delete next.productName;
      if (accentColor.trim()) next.accentColor = accentColor.trim();
      else delete next.accentColor;
      if (logoAssetId) next.logoAssetId = logoAssetId;
      else delete next.logoAssetId;
      if (hidePlatformBranding) next.hidePlatformBranding = true;
      else delete next.hidePlatformBranding;
      if (supportEmail.trim()) next.supportEmail = supportEmail.trim();
      else delete next.supportEmail;
      if (legalName.trim()) next.legalName = legalName.trim();
      else delete next.legalName;
      if (membersAreaEnabled) next.membersAreaEnabled = true;
      else delete next.membersAreaEnabled;

      const updated = await updateTenant(tenant.id, { brandingJson: next });
      useDesigner.setState((s) => ({
        tenants: s.tenants.map((t) => (t.id === updated.id ? updated : t)),
      }));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Brand" subtitle="white-label">
      <FieldRow label="Logo" hint="Replaces the platform mark in the header.">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-ink-700 bg-ink-900">
            <img
              src={logoAssetId ? assetBlobUrl(logoAssetId) : "/branding/mark.svg"}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <button
            type="button"
            onClick={picker.open}
            className="rounded border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
          >
            {logoAssetId ? "Change…" : "Pick from assets…"}
          </button>
          {logoAssetId && (
            <button
              type="button"
              onClick={() => setLogoAssetId(null)}
              className="rounded border border-transparent px-2 py-1 text-[11px] text-ink-400 hover:border-ink-700 hover:bg-ink-800 hover:text-ink-100"
              title="Reset to platform default"
            >
              Use default
            </button>
          )}
          {picker.element}
        </div>
      </FieldRow>
      <FieldRow label="Product name" hint="Replaces 'TCGStudio' in the header.">
        <input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="(use platform default)"
          maxLength={60}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-600 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        />
      </FieldRow>
      <FieldRow label="Accent color" hint="Hex color used for active states + buttons.">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={normalizeHex(accentColor)}
            onChange={(e) => setAccentColor(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-ink-700 bg-ink-900 p-0.5"
          />
          <input
            type="text"
            value={accentColor}
            placeholder="#d4a24c"
            onChange={(e) => setAccentColor(e.target.value)}
            className="block flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          />
        </div>
      </FieldRow>
      <FieldRow label="Support email">
        <input
          type="email"
          value={supportEmail}
          onChange={(e) => setSupportEmail(e.target.value)}
          placeholder="support@studio.example"
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-600 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        />
      </FieldRow>
      <FieldRow label="Legal name" hint="Used in card-footer copyright on PNG export.">
        <input
          type="text"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="Studio Ltd."
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-600 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        />
      </FieldRow>
      <FieldRow label="Hide platform" hint="Drops the 'Designer' badge from the header.">
        <label className="inline-flex items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100">
          <input
            type="checkbox"
            checked={hidePlatformBranding}
            onChange={(e) => setHidePlatformBranding(e.target.checked)}
            className="h-3 w-3 cursor-pointer accent-accent-500"
          />
          <span>White-label mode</span>
        </label>
      </FieldRow>

      <FieldRow
        label="Members area"
        hint="When on, end-users can sign up + sign in at /login on this tenant's subdomain and land at /members. Extend by publishing CMS pages: __login (login screen hero), __members (post-login home), or any other slug to surface at /members/<slug>. Add a CMS navigation with placement 'members' to drive the in-app nav strip."
      >
        <label className="inline-flex items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100">
          <input
            type="checkbox"
            checked={membersAreaEnabled}
            onChange={(e) => setMembersAreaEnabled(e.target.checked)}
            className="h-3 w-3 cursor-pointer accent-accent-500"
          />
          <span>Enable members area</span>
        </label>
      </FieldRow>

      <div className="flex items-center justify-end gap-2 border-t border-ink-800 pt-3">
        {error && <span className="mr-auto text-[11px] text-danger-500">{error}</span>}
        {savedTick && (
          <span className="mr-auto text-[11px] text-emerald-300">Saved.</span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
        >
          {saving ? "Saving…" : "Save brand"}
        </button>
      </div>
    </Section>
  );
}

function normalizeHex(input: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(input)) return input;
  if (/^#[0-9a-fA-F]{3}$/.test(input)) {
    const [, r, g, b] = input.match(/#(.)(.)(.)/) ?? [];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#d4a24c";
}

/* ---------------------------------------------------------------------- */
/* Email provider (sec 51 — tenant-configurable SMTP)                     */
/* ---------------------------------------------------------------------- */

const EMAIL_PROVIDER_OPTIONS = [
  { value: "default", label: "Platform default", hint: "Use the platform's outgoing mail." },
  { value: "smtp", label: "SMTP", hint: "Generic SMTP host (Mailgun, custom, etc.)." },
  { value: "sendgrid", label: "SendGrid", hint: "API-key based — fastest setup." },
  { value: "postmark", label: "Postmark", hint: "Transactional email service." },
  { value: "ses", label: "Amazon SES", hint: "AWS Simple Email Service." },
  { value: "resend", label: "Resend", hint: "Resend.com transactional API." },
] as const;

/**
 * Per-tenant email provider config. Stored on `Tenant.emailSettingsJson`
 * as a free-form blob keyed by `provider`. Secrets (passwords / API
 * keys) round-trip as plaintext over HTTPS to the API; the lib/secrets
 * layer is responsible for at-rest encryption when configured.
 */
function EmailProviderSection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const [config, setConfig] = useState<Record<string, string>>({
    provider: "default",
    fromAddress: "",
    fromName: "",
    replyTo: "",
    host: "",
    port: "587",
    username: "",
    password: "",
    apiKey: "",
    region: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant) return;
    const existing = (tenant as unknown as { emailSettingsJson?: Record<string, unknown> })
      .emailSettingsJson;
    if (existing && typeof existing === "object") {
      setConfig((c) => ({
        ...c,
        ...Object.fromEntries(
          Object.entries(existing).map(([k, v]) => [
            k,
            typeof v === "string" || typeof v === "number" ? String(v) : "",
          ]),
        ),
      }));
    }
  }, [tenant?.id]);

  const provider = config.provider || "default";
  const showSmtp = provider === "smtp";
  const showApiKey = provider === "sendgrid" || provider === "postmark" || provider === "resend";
  const showSes = provider === "ses";

  function update(key: string, value: string) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    if (!tenant) return;
    setBusy(true);
    setError(null);
    try {
      // Strip empty strings so we don't persist noise.
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(config)) {
        if (v.trim()) trimmed[k] = v.trim();
      }
      await updateTenant(tenant.id, {
        emailSettingsJson: trimmed,
      } as unknown as Parameters<typeof updateTenant>[1]);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Email provider" subtitle="outbound email">
      <p className="text-[11px] text-ink-500">
        Configure how this workspace sends invitation emails, password resets,
        and notifications. Leave on "Platform default" to use the platform's
        sender.
      </p>

      <FieldRow label="Provider">
        <select
          value={provider}
          onChange={(e) => update("provider", e.target.value)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        >
          {EMAIL_PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <p className="-mt-1 mb-1 text-[10px] text-ink-500">
        {EMAIL_PROVIDER_OPTIONS.find((p) => p.value === provider)?.hint}
      </p>

      {provider !== "default" && (
        <>
          <FieldRow label="From address">
            <input
              type="email"
              value={config.fromAddress}
              onChange={(e) => update("fromAddress", e.target.value)}
              placeholder="noreply@yourdomain.com"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          <FieldRow label="From name">
            <input
              type="text"
              value={config.fromName}
              onChange={(e) => update("fromName", e.target.value)}
              placeholder="Acme Studio"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Reply-to (optional)">
            <input
              type="email"
              value={config.replyTo}
              onChange={(e) => update("replyTo", e.target.value)}
              placeholder="support@yourdomain.com"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
        </>
      )}

      {showSmtp && (
        <>
          <FieldRow label="Host">
            <input
              type="text"
              value={config.host}
              onChange={(e) => update("host", e.target.value)}
              placeholder="smtp.mailgun.org"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Port">
            <input
              type="number"
              value={config.port}
              onChange={(e) => update("port", e.target.value)}
              placeholder="587"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Username">
            <input
              type="text"
              value={config.username}
              onChange={(e) => update("username", e.target.value)}
              autoComplete="off"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Password">
            <input
              type="password"
              value={config.password}
              onChange={(e) => update("password", e.target.value)}
              autoComplete="new-password"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
        </>
      )}

      {showApiKey && (
        <FieldRow label="API key">
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => update("apiKey", e.target.value)}
            autoComplete="new-password"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
      )}

      {showSes && (
        <>
          <FieldRow label="AWS region">
            <input
              type="text"
              value={config.region}
              onChange={(e) => update("region", e.target.value)}
              placeholder="us-east-1"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Access key ID">
            <input
              type="text"
              value={config.accessKeyId}
              onChange={(e) => update("accessKeyId", e.target.value)}
              autoComplete="off"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Secret access key">
            <input
              type="password"
              value={config.secretAccessKey}
              onChange={(e) => update("secretAccessKey", e.target.value)}
              autoComplete="new-password"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
        </>
      )}

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save email config"}
        </button>
        {savedAt && (
          <span className="text-[10px] text-ink-500">
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* Storage provider (sec 43)                                              */
/* ---------------------------------------------------------------------- */

const STORAGE_PROVIDER_OPTIONS = [
  { value: "default", label: "Platform default", hint: "Use the platform's storage (MinIO in dev, R2 in prod)." },
  { value: "s3", label: "Amazon S3" },
  { value: "r2", label: "Cloudflare R2" },
  { value: "minio", label: "MinIO (self-hosted S3-compatible)" },
  { value: "gcs", label: "Google Cloud Storage" },
  { value: "azure", label: "Azure Blob" },
] as const;

/**
 * Per-tenant storage backend. Stored on `Tenant.storageSettingsJson`.
 * The asset-upload pipeline reads this to decide where new uploads
 * go; existing assets stay where they were uploaded (no auto-migration).
 */
function StorageProviderSection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const [config, setConfig] = useState<Record<string, string>>({
    provider: "default",
    bucket: "",
    region: "",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrlPrefix: "",
    forcePathStyle: "false",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant) return;
    const existing = (tenant as unknown as { storageSettingsJson?: Record<string, unknown> })
      .storageSettingsJson;
    if (existing && typeof existing === "object") {
      setConfig((c) => ({
        ...c,
        ...Object.fromEntries(
          Object.entries(existing).map(([k, v]) => [
            k,
            typeof v === "string" || typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : "",
          ]),
        ),
      }));
    }
  }, [tenant?.id]);

  const provider = config.provider || "default";
  const showFields = provider !== "default";

  function update(key: string, value: string) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    if (!tenant) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
        if (k === "forcePathStyle") {
          trimmed[k] = v === "true";
        } else if (v.trim()) {
          trimmed[k] = v.trim();
        }
      }
      await updateTenant(tenant.id, {
        storageSettingsJson: trimmed,
      } as unknown as Parameters<typeof updateTenant>[1]);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Storage provider" subtitle="asset uploads">
      <p className="text-[11px] text-ink-500">
        Where new asset uploads land. Defaults to the platform storage. Switch
        to your own S3-compatible bucket for data residency or cost control.
        Existing assets stay where they were uploaded — there's no auto-
        migration on switch.
      </p>

      <FieldRow label="Provider">
        <select
          value={provider}
          onChange={(e) => update("provider", e.target.value)}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        >
          {STORAGE_PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <p className="-mt-1 mb-1 text-[10px] text-ink-500">
        {STORAGE_PROVIDER_OPTIONS.find((p) => p.value === provider)?.hint ?? ""}
      </p>

      {showFields && (
        <>
          <FieldRow label="Bucket">
            <input
              type="text"
              value={config.bucket}
              onChange={(e) => update("bucket", e.target.value)}
              placeholder="tcgstudio-acme"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Region">
            <input
              type="text"
              value={config.region}
              onChange={(e) => update("region", e.target.value)}
              placeholder="auto"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Endpoint (optional)">
            <input
              type="text"
              value={config.endpoint}
              onChange={(e) => update("endpoint", e.target.value)}
              placeholder="https://<account>.r2.cloudflarestorage.com"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Access key ID">
            <input
              type="text"
              value={config.accessKeyId}
              onChange={(e) => update("accessKeyId", e.target.value)}
              autoComplete="off"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Secret access key">
            <input
              type="password"
              value={config.secretAccessKey}
              onChange={(e) => update("secretAccessKey", e.target.value)}
              autoComplete="new-password"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Public URL prefix">
            <input
              type="text"
              value={config.publicUrlPrefix}
              onChange={(e) => update("publicUrlPrefix", e.target.value)}
              placeholder="https://cdn.acme.games"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Force path style">
            <select
              value={config.forcePathStyle}
              onChange={(e) => update("forcePathStyle", e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            >
              <option value="false">No (virtual-hosted, default)</option>
              <option value="true">Yes (required by MinIO and some S3 clones)</option>
            </select>
          </FieldRow>
        </>
      )}

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save storage config"}
        </button>
        {savedAt && (
          <span className="text-[10px] text-ink-500">
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* Project providers — email + storage at project scope                   */
/* ---------------------------------------------------------------------- */
//
// Same shape as the tenant-scope sections above, but read/write the
// active project's `emailSettingsJson` / `storageSettingsJson` columns.
// Per the user's directive: tenants don't get their own storage tier
// (the platform handles that), but projects can route uploads to a
// dedicated bucket for residency or cost reasons.

function ProjectEmailProviderSection() {
  const project = useDesigner(selectActiveProject);
  const [config, setConfig] = useState<Record<string, string>>({
    provider: "default",
    fromAddress: "",
    fromName: "",
    replyTo: "",
    host: "",
    port: "587",
    username: "",
    password: "",
    apiKey: "",
    region: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!project) return;
    const existing = (project as unknown as { emailSettingsJson?: Record<string, unknown> })
      .emailSettingsJson;
    if (existing && typeof existing === "object") {
      setConfig((c) => ({
        ...c,
        ...Object.fromEntries(
          Object.entries(existing).map(([k, v]) => [
            k,
            typeof v === "string" || typeof v === "number" ? String(v) : "",
          ]),
        ),
      }));
    }
  }, [project?.id]);

  const provider = config.provider || "default";

  async function save() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(config)) {
        if (v.trim()) trimmed[k] = v.trim();
      }
      const lib = await import("@/lib/api");
      await lib.request(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        body: { emailSettingsJson: trimmed },
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!project) return null;
  return (
    <Section title="Email provider" subtitle="project-scope">
      <p className="text-[11px] text-ink-500">
        Per-project email settings. Falls back to the tenant or platform
        default when this project leaves it on "Platform default" — useful
        for branded transactional emails (newsletter, commerce receipts).
      </p>
      <FieldRow label="Provider">
        <select
          value={provider}
          onChange={(e) => setConfig((c) => ({ ...c, provider: e.target.value }))}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        >
          {EMAIL_PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </FieldRow>
      {provider !== "default" && (
        <>
          <FieldRow label="From address">
            <input
              type="email"
              value={config.fromAddress}
              onChange={(e) => setConfig((c) => ({ ...c, fromAddress: e.target.value }))}
              placeholder="hello@yourgame.com"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          <FieldRow label="From name">
            <input
              type="text"
              value={config.fromName}
              onChange={(e) => setConfig((c) => ({ ...c, fromName: e.target.value }))}
              placeholder="Saga: Tales Unchained"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </FieldRow>
          {provider === "smtp" && (
            <>
              <FieldRow label="SMTP host">
                <input
                  type="text"
                  value={config.host}
                  onChange={(e) => setConfig((c) => ({ ...c, host: e.target.value }))}
                  className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                />
              </FieldRow>
              <FieldRow label="Username">
                <input
                  type="text"
                  value={config.username}
                  onChange={(e) => setConfig((c) => ({ ...c, username: e.target.value }))}
                  autoComplete="off"
                  className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                />
              </FieldRow>
              <FieldRow label="Password">
                <input
                  type="password"
                  value={config.password}
                  onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))}
                  autoComplete="new-password"
                  className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
                />
              </FieldRow>
            </>
          )}
          {(provider === "sendgrid" || provider === "postmark" || provider === "resend") && (
            <FieldRow label="API key">
              <input
                type="password"
                value={config.apiKey}
                onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
                autoComplete="new-password"
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
              />
            </FieldRow>
          )}
        </>
      )}
      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save email config"}
        </button>
        {savedAt && (
          <span className="text-[10px] text-ink-500">
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </Section>
  );
}

function ProjectStorageProviderSection() {
  const project = useDesigner(selectActiveProject);
  const [config, setConfig] = useState<Record<string, string>>({
    provider: "default",
    bucket: "",
    region: "",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrlPrefix: "",
    forcePathStyle: "false",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!project) return;
    const existing = (project as unknown as { storageSettingsJson?: Record<string, unknown> })
      .storageSettingsJson;
    if (existing && typeof existing === "object") {
      setConfig((c) => ({
        ...c,
        ...Object.fromEntries(
          Object.entries(existing).map(([k, v]) => [
            k,
            typeof v === "string" || typeof v === "boolean" ? String(v) : "",
          ]),
        ),
      }));
    }
  }, [project?.id]);

  const provider = config.provider || "default";
  const showFields = provider !== "default";

  async function save() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
        if (k === "forcePathStyle") {
          trimmed[k] = v === "true";
        } else if (v.trim()) {
          trimmed[k] = v.trim();
        }
      }
      const lib = await import("@/lib/api");
      await lib.request(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        body: { storageSettingsJson: trimmed },
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!project) return null;
  return (
    <Section title="Storage provider" subtitle="project-scope">
      <p className="text-[11px] text-ink-500">
        Where this project's asset uploads land. Project-scope only —
        tenants don't have their own storage tier; the platform handles
        that. Existing assets stay where they were uploaded; switching
        only affects new uploads.
      </p>
      <FieldRow label="Provider">
        <select
          value={provider}
          onChange={(e) => setConfig((c) => ({ ...c, provider: e.target.value }))}
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        >
          {STORAGE_PROVIDER_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </FieldRow>
      {showFields && (
        <>
          <FieldRow label="Bucket">
            <input
              type="text"
              value={config.bucket}
              onChange={(e) => setConfig((c) => ({ ...c, bucket: e.target.value }))}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Region">
            <input
              type="text"
              value={config.region}
              onChange={(e) => setConfig((c) => ({ ...c, region: e.target.value }))}
              placeholder="auto"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Endpoint (optional)">
            <input
              type="text"
              value={config.endpoint}
              onChange={(e) => setConfig((c) => ({ ...c, endpoint: e.target.value }))}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Access key ID">
            <input
              type="text"
              value={config.accessKeyId}
              onChange={(e) => setConfig((c) => ({ ...c, accessKeyId: e.target.value }))}
              autoComplete="off"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Secret access key">
            <input
              type="password"
              value={config.secretAccessKey}
              onChange={(e) => setConfig((c) => ({ ...c, secretAccessKey: e.target.value }))}
              autoComplete="new-password"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
          <FieldRow label="Public URL prefix">
            <input
              type="text"
              value={config.publicUrlPrefix}
              onChange={(e) => setConfig((c) => ({ ...c, publicUrlPrefix: e.target.value }))}
              placeholder="https://cdn.yourgame.com"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
            />
          </FieldRow>
        </>
      )}
      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save storage config"}
        </button>
        {savedAt && (
          <span className="text-[10px] text-ink-500">
            saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* Custom domains (sec 11.5)                                              */
/* ---------------------------------------------------------------------- */

function DomainsSection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const [domains, setDomains] = useState<import("@/lib/api").TenantDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingInstructions, setPendingInstructions] = useState<{
    domainId: string;
    instructions: import("@/lib/api").DnsInstructions;
  } | null>(null);
  /// Per-row inline DNS-check display. Survives a row re-render so users
  /// can read the lookup results after closing the modal.
  const [lastChecks, setLastChecks] = useState<
    Record<string, import("@/lib/api").DomainCheckResult>
  >({});

  const refresh = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const list = await import("@/lib/api").then((m) => m.listTenantDomains());
      setDomains(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!tenant) return null;

  return (
    <Section title="Custom domains" subtitle={`${domains.length} attached`}>
      <p className="text-[11px] text-ink-500">
        Point your own hostname (e.g. <code className="font-mono">acmegames.com</code>) at this
        tenant. Add a CNAME plus a TXT verification record, then click verify. Once active, the
        domain resolves directly to this workspace — and{" "}
        <code className="font-mono">{"<project>"}.acmegames.com</code> resolves to a project
        scope inside it.
      </p>

      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-500">
          {error}
        </p>
      )}

      <ul className="divide-y divide-ink-800 rounded border border-ink-800">
        {loading && domains.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">Loading…</li>
        ) : domains.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-ink-500">
            No custom domains yet.
          </li>
        ) : (
          domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              lastCheck={lastChecks[d.id]}
              onVerify={async () => {
                try {
                  const lib = await import("@/lib/api");
                  const r = await lib.verifyTenantDomain(d.id);
                  setDomains((prev) =>
                    prev.map((x) => (x.id === d.id ? r.domain : x)),
                  );
                  setLastChecks((prev) => ({ ...prev, [d.id]: r.check }));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "verify failed");
                }
              }}
              onPrimary={async () => {
                try {
                  const lib = await import("@/lib/api");
                  await lib.updateTenantDomain(d.id, { isPrimary: true });
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "save failed");
                }
              }}
              onDelete={async () => {
                if (!confirm(`Remove ${d.hostname}?`)) return;
                try {
                  const lib = await import("@/lib/api");
                  await lib.deleteTenantDomain(d.id);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "delete failed");
                }
              }}
              onShowInstructions={async () => {
                try {
                  const lib = await import("@/lib/api");
                  const r = await lib.getTenantDomain(d.id);
                  setPendingInstructions({ domainId: d.id, instructions: r.instructions });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "fetch failed");
                }
              }}
            />
          ))
        )}
      </ul>

      {pendingInstructions && (
        <DomainDnsInstructions
          instructions={pendingInstructions.instructions}
          onClose={() => setPendingInstructions(null)}
        />
      )}

      {creating ? (
        <NewDomainForm
          onCancel={() => setCreating(false)}
          onCreated={async (instructions, domain) => {
            setDomains((prev) => [...prev, domain]);
            setCreating(false);
            setPendingInstructions({ domainId: domain.id, instructions });
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
        >
          + Add domain
        </button>
      )}
    </Section>
  );
}

function DomainRow({
  domain,
  lastCheck,
  onVerify,
  onPrimary,
  onDelete,
  onShowInstructions,
}: {
  domain: import("@/lib/api").TenantDomain;
  lastCheck?: import("@/lib/api").DomainCheckResult;
  onVerify: () => void;
  onPrimary: () => void;
  onDelete: () => void;
  onShowInstructions: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Color the status pill so "pending" reads as something the user
  // needs to act on, "active" reads as a happy-path success.
  const statusCls =
    domain.status === "active"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : domain.status === "verified"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
      : domain.status === "pending"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : domain.status === "failed"
      ? "border-danger-500/40 bg-danger-500/10 text-danger-400"
      : "border-ink-700 bg-ink-800 text-ink-400";

  const reasonText = describeReason(domain.statusReason);

  return (
    <li className="space-y-1.5 px-3 py-2">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink-100">
            {domain.hostname}
            {domain.isPrimary && (
              <span className="ml-1.5 rounded-full border border-accent-500/40 bg-accent-500/10 px-1.5 text-[9px] uppercase tracking-wider text-accent-300">
                primary
              </span>
            )}
          </p>
          {domain.projectSlug && (
            <p className="truncate text-[10px] text-ink-500">
              pins to project <span className="font-mono">{domain.projectSlug}</span>
            </p>
          )}
        </div>
        <span
          className={[
            "rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            statusCls,
          ].join(" ")}
          title={reasonText ?? domain.status}
        >
          {domain.status}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onShowInstructions}
            className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800"
          >
            DNS
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onVerify();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || domain.status === "disabled"}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            title="Re-run live DNS lookup"
          >
            {busy
              ? "Checking…"
              : domain.status === "active"
              ? "Re-check"
              : "Verify"}
          </button>
          {!domain.isPrimary && (
            <button
              type="button"
              onClick={onPrimary}
              className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800"
            >
              Make primary
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-transparent px-2 py-0.5 text-[11px] text-ink-500 hover:bg-danger-500/10 hover:text-danger-500"
          >
            ×
          </button>
        </div>
      </div>

      {(reasonText || domain.lastCheckedAt) && (
        <p className="text-[10px] text-ink-500">
          {reasonText && <span>{reasonText}</span>}
          {reasonText && domain.lastCheckedAt && <span> · </span>}
          {domain.lastCheckedAt && (
            <span>
              checked {new Date(domain.lastCheckedAt).toLocaleString()}
            </span>
          )}
        </p>
      )}

      {lastCheck && <DomainCheckSummary check={lastCheck} />}
    </li>
  );
}

/** Human-readable explanation of a `statusReason` machine string. */
function describeReason(
  reason: import("@/lib/api").TenantDomainStatusReason,
): string | null {
  switch (reason) {
    case "ok":
      return "DNS records look good — domain is serving traffic.";
    case "txt_missing":
      return "Waiting for the TXT verification record to appear.";
    case "txt_mismatch":
      return "TXT record found, but the value doesn't match — copy it again from DNS instructions.";
    case "cname_missing":
      return "Ownership verified. Add the CNAME so traffic can reach us.";
    case "cname_wrong_target":
      return "CNAME exists but points somewhere else — check the value matches the DNS instructions.";
    case "dns_lookup_failed":
      return "DNS lookup failed — your records may not have propagated yet (try again in a few minutes).";
    case "manual_disabled":
      return "Manually disabled in admin settings.";
    case null:
    case undefined:
      return null;
    default:
      return null;
  }
}

/** Inline summary of the most recent live DNS check — shown after the
 *  user clicks Verify so they can see exactly what we observed. */
function DomainCheckSummary({
  check,
}: {
  check: import("@/lib/api").DomainCheckResult;
}) {
  return (
    <div className="rounded border border-ink-800 bg-ink-950 p-2 text-[10px] text-ink-400">
      <CheckLine
        label="TXT"
        ok={check.txt.matched}
        detail={
          check.txt.matched
            ? "matches verification token"
            : check.txt.error
            ? `lookup error (${check.txt.error})`
            : check.txt.found && check.txt.found.length > 0
            ? `found ${check.txt.found.length} record(s), none matched`
            : "no TXT record at " + check.txt.name
        }
      />
      <CheckLine
        label="CNAME"
        ok={check.cname.matched}
        detail={
          check.cname.matched
            ? `points at ${(check.cname.found ?? []).join(", ")}`
            : check.cname.error
            ? `lookup error (${check.cname.error})`
            : check.cname.found && check.cname.found.length > 0
            ? `points at ${check.cname.found.join(", ")} — expected ${check.cname.expected.join(" / ")}`
            : "no record found"
        }
      />
    </div>
  );
}

function CheckLine({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <p className="flex items-baseline gap-2">
      <span
        className={[
          "inline-block w-3 text-center",
          ok ? "text-emerald-400" : "text-amber-400",
        ].join(" ")}
        aria-hidden="true"
      >
        {ok ? "✓" : "•"}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-300">
        {label}
      </span>
      <span>{detail}</span>
    </p>
  );
}

function NewDomainForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (
    instructions: import("@/lib/api").DnsInstructions,
    domain: import("@/lib/api").TenantDomain,
  ) => void;
}) {
  const [hostname, setHostname] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!hostname) return;
        setBusy(true);
        setError(null);
        try {
          const lib = await import("@/lib/api");
          const r = await lib.createTenantDomain({
            hostname: hostname.toLowerCase(),
            projectSlug: projectSlug.trim() || undefined,
          });
          onCreated(r.instructions, r.domain);
        } catch (err) {
          setError(err instanceof Error ? err.message : "create failed");
        } finally {
          setBusy(false);
        }
      }}
      className="grid grid-cols-[1fr_140px_auto_auto] items-end gap-2 border-t border-ink-800 pt-3"
    >
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">Hostname</span>
        <input
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="cards.acmegames.com"
          autoFocus
          className="mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">
          Pin to project
        </span>
        <input
          type="text"
          value={projectSlug}
          onChange={(e) => setProjectSlug(e.target.value.toLowerCase())}
          placeholder="(optional)"
          className="mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
        />
      </label>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || !hostname}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
      >
        {busy ? "…" : "Add"}
      </button>
      {error && <p className="col-span-full text-[11px] text-danger-500">{error}</p>}
    </form>
  );
}

function DomainDnsInstructions({
  instructions,
  onClose,
}: {
  instructions: import("@/lib/api").DnsInstructions;
  onClose: () => void;
}) {
  return (
    <div className="rounded border border-accent-500/30 bg-accent-500/5 p-3 text-[11px] text-ink-200">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-ink-50">DNS records to add</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          Close
        </button>
      </div>
      <p className="mb-2 text-ink-400">
        Add these to your DNS provider, then come back and click "Verify".
      </p>
      <DnsRecord
        type="TXT"
        name={instructions.txt.name}
        value={instructions.txt.value}
        note={`TTL ${instructions.txt.ttl}s — proves you control the domain.`}
      />
      <DnsRecord
        type="CNAME"
        name={instructions.cname.name}
        value={instructions.cname.value}
        note={instructions.cname.note}
      />
    </div>
  );
}

function DnsRecord({
  type,
  name,
  value,
  note,
}: {
  type: string;
  name: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="mb-2 last:mb-0 rounded border border-ink-800 bg-ink-900/40 p-2">
      <div className="grid grid-cols-[60px_1fr] gap-2 font-mono text-[11px]">
        <span className="text-ink-500">type</span>
        <span className="text-ink-100">{type}</span>
        <span className="text-ink-500">name</span>
        <span className="break-all text-ink-100">{name}</span>
        <span className="text-ink-500">value</span>
        <span className="break-all text-ink-100">{value}</span>
      </div>
      {note && <p className="mt-1 text-[10px] text-ink-500">{note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Public gallery                                                         */
/* ---------------------------------------------------------------------- */

function PublicGallerySection() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const [copied, setCopied] = useState(false);
  if (!tenant) return null;
  const url = `${window.location.origin}/public/${tenant.slug}`;
  return (
    <Section title="Public gallery" subtitle="no auth required">
      <p className="text-[11px] text-ink-500">
        Anyone with this URL can browse <code className="font-mono">{tenant.slug}</code>'s
        released cards. Only cards with status{" "}
        <code className="font-mono">released</code> /{" "}
        <code className="font-mono">approved</code> appear, and only assets marked{" "}
        <code className="font-mono">public</code> are served. Drafts stay private.
      </p>
      <FieldRow label="URL">
        <div className="flex items-center gap-2">
          <Code>{url}</Code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
          >
            Open ↗
          </a>
        </div>
      </FieldRow>
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* API connection                                                         */
/* ---------------------------------------------------------------------- */

function ApiInfo() {
  return (
    <Section title="API connection">
      <FieldRow label="Base URL">
        <Code>{apiHealth.base}</Code>
      </FieldRow>
      <FieldRow label="X-Tenant-Slug">
        <Code>{apiHealth.tenantSlug}</Code>
      </FieldRow>
      <p className="text-[11px] text-ink-500">
        Every API call from the designer carries this header so the server scopes its data to
        this workspace. Switching workspaces in the header dropdown updates it instantly.
      </p>
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* Other workspaces (switch / create)                                     */
/* ---------------------------------------------------------------------- */

function OtherWorkspaces() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const selectTenant = useDesigner((s) => s.selectTenant);
  const others = tenants.filter((t) => t.slug !== activeSlug);

  return (
    <Section title="Other workspaces" subtitle={`${others.length} accessible`}>
      {others.length === 0 ? (
        <p className="text-[11px] text-ink-500">
          You only have one workspace. Create another below.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {others.map((t) => (
            <OtherTenantRow
              key={t.id}
              tenant={t}
              onSwitch={() => selectTenant(t.slug)}
            />
          ))}
        </ul>
      )}
      <CreateWorkspaceForm />
    </Section>
  );
}

function OtherTenantRow({ tenant, onSwitch }: { tenant: Tenant; onSwitch: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-100">{tenant.name}</p>
        <p className="truncate font-mono text-[10px] text-ink-500">{tenant.slug}</p>
      </div>
      <span
        className={[
          "rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
          tenant.status === "active"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-ink-700 bg-ink-800 text-ink-400",
        ].join(" ")}
      >
        {tenant.status}
      </span>
      <button
        type="button"
        onClick={onSwitch}
        className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
      >
        Switch into
      </button>
    </li>
  );
}

/**
 * Create-workspace launcher. Renders a "+ Create workspace" button
 * until the user opens the wizard, then swaps in `TenantWizard` for
 * the multi-step flow. The wizard captures company name, type,
 * white-label info — all of which flows through to the auto-seeded
 * CMS landing page.
 */
function CreateWorkspaceForm() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-[11px] text-ink-100 hover:bg-ink-700"
      >
        + Create workspace
      </button>
    );
  }
  return (
    <div className="mt-2">
      <TenantWizard onClose={() => setOpen(false)} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Danger zone                                                            */
/* ---------------------------------------------------------------------- */
//
// Delete-the-current-tenant. Cascades on the API side. We keep the
// affordance behind a confirm + a "type the slug to confirm" gate so
// a misclick can't nuke a workspace.

function DangerZone() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!tenant) return null;

  async function destroy() {
    if (!tenant) return;
    setBusy(true);
    setError(null);
    try {
      const { deleteTenant: del } = await import("@/lib/api");
      await del(tenant.id);
      // Drop the tenant from the local store and refresh — the
      // app shell will redirect to whichever tenant is left.
      useDesigner.setState((s) => ({
        tenants: s.tenants.filter((t) => t.id !== tenant.id),
      }));
      const remaining = useDesigner.getState().tenants;
      if (remaining.length > 0) {
        useDesigner.getState().selectTenant(remaining[0].slug);
      } else {
        // No tenants left — sign out so the app doesn't get stuck.
        useDesigner.getState().signOut();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Danger zone" subtitle="irreversible">
      <p className="text-[11px] text-ink-500">
        Permanently delete <code className="font-mono">{tenant.slug}</code> and every project,
        card, asset, CMS page, and audit row inside it. There is no soft-undo.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-medium text-danger-400 hover:bg-danger-500/20"
        >
          Delete this workspace…
        </button>
      ) : (
        <div className="space-y-2 rounded border border-danger-500/40 bg-danger-500/5 p-3">
          <p className="text-[11px] text-ink-300">
            Type{" "}
            <code className="font-mono text-ink-100">{tenant.slug}</code> to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100"
            autoFocus
          />
          {error && (
            <p className="text-[11px] text-danger-400">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmText("");
                setError(null);
              }}
              disabled={busy}
              className="rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={destroy}
              disabled={busy || confirmText !== tenant.slug}
              className="rounded border border-danger-500/40 bg-danger-500/15 px-3 py-1.5 text-[11px] font-medium text-danger-400 hover:bg-danger-500/25 disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------------- */
/* Primitives                                                             */
/* ---------------------------------------------------------------------- */
//
// Settings sections share a common shell: a titled card with an
// optional subtitle, plus FieldRow / Code helpers for label + value
// pairs. Defining them once here keeps the section files thin.

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="flex items-baseline justify-between border-b border-ink-800 pb-2">
        <h2 className="text-sm font-medium text-ink-100">{title}</h2>
        {subtitle && (
          <span className="text-[10px] uppercase tracking-wider text-ink-500">
            {subtitle}
          </span>
        )}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div>
        <p className="text-[11px] font-medium text-ink-200">{label}</p>
        {hint && <p className="text-[10px] text-ink-500">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="inline-block rounded border border-ink-800 bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-ink-200">
      {children}
    </code>
  );
}