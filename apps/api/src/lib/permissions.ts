/**
 * Permission catalog (sec 13.6).
 *
 * All authorization checks across the API resolve to a permission
 * string in this catalog. Roles (the `Role` table) hold a list of
 * these strings; the helper below answers "does this user have
 * permission P at scope X?".
 *
 * Wildcard convention: `tenants:*` grants every `tenants:` permission;
 * `*` (in a permission list) grants everything in scope.
 *
 * The catalog is intentionally hand-curated rather than scraped from
 * code: making a permission appear in the picker is a deliberate act,
 * not a side-effect of some route's name.
 */

export interface PermissionDef {
  /** Dotted-namespace permission string used in DB / role JSON. */
  key: string;
  /** Human label for the permission picker. */
  label: string;
  /** Longer description shown in the picker tooltip. */
  description: string;
  /** Where this permission lives — drives which Roles can hold it. */
  scope: "platform" | "tenant" | "project";
  /** Group name for the picker UI. */
  group: string;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  // ----- platform scope ----------------------------------------------------
  {
    key: "platform:*",
    label: "Full platform control",
    description: "All platform permissions, including granting other owners.",
    scope: "platform",
    group: "Platform",
  },
  {
    key: "tenants:read",
    label: "View tenants",
    description: "List every tenant in the directory.",
    scope: "platform",
    group: "Tenants",
  },
  {
    key: "tenants:update",
    label: "Suspend / reactivate tenants",
    description: "Change tenant status (suspend, reactivate, disable).",
    scope: "platform",
    group: "Tenants",
  },
  {
    key: "tenants:delete",
    label: "Delete tenants",
    description: "Permanently remove a tenant and all of its data.",
    scope: "platform",
    group: "Tenants",
  },
  {
    key: "billing:read",
    label: "View platform billing",
    description: "MRR, plan distribution, churn signals.",
    scope: "platform",
    group: "Billing",
  },
  {
    key: "billing:update",
    label: "Manage platform billing",
    description: "Edit payment processor config and override tenant subscriptions.",
    scope: "platform",
    group: "Billing",
  },
  {
    key: "plans:read",
    label: "View plans",
    description: "Read the plan catalog.",
    scope: "platform",
    group: "Billing",
  },
  {
    key: "plans:update",
    label: "Edit plans",
    description: "Create, edit, and archive plans.",
    scope: "platform",
    group: "Billing",
  },
  {
    key: "announcements:read",
    label: "View announcements",
    description: "Read the platform announcement banner list.",
    scope: "platform",
    group: "Marketing",
  },
  {
    key: "announcements:write",
    label: "Manage announcements",
    description: "Author, edit, and retract platform-wide banners.",
    scope: "platform",
    group: "Marketing",
  },
  {
    key: "admins:read",
    label: "View platform admins",
    description: "See who holds platform roles.",
    scope: "platform",
    group: "Admins",
  },
  {
    key: "admins:grant_admin",
    label: "Grant admin role",
    description: "Promote a user to platform admin.",
    scope: "platform",
    group: "Admins",
  },
  {
    key: "admins:grant_support",
    label: "Grant support role",
    description: "Promote a user to platform support.",
    scope: "platform",
    group: "Admins",
  },
  {
    key: "admins:grant_owner",
    label: "Grant owner role",
    description: "Promote a user to platform owner. Owner-only by default.",
    scope: "platform",
    group: "Admins",
  },
  {
    key: "admins:revoke_non_owner",
    label: "Revoke admin / support",
    description: "Remove non-owner platform roles.",
    scope: "platform",
    group: "Admins",
  },
  {
    key: "roles:read",
    label: "View roles",
    description: "Read the platform roles list.",
    scope: "platform",
    group: "Admins",
  },
  {
    key: "roles:write",
    label: "Manage roles",
    description: "Create custom roles and edit their permissions.",
    scope: "platform",
    group: "Admins",
  },

  // ----- tenant scope ------------------------------------------------------
  {
    key: "tenant:read",
    label: "View workspace metadata",
    description: "See basic tenant info.",
    scope: "tenant",
    group: "Tenant",
  },
  {
    key: "tenant:update",
    label: "Edit workspace settings",
    description: "Rename, change locale, change tenant type.",
    scope: "tenant",
    group: "Tenant",
  },
  {
    key: "tenant:delete",
    label: "Delete the workspace",
    description: "Permanent — cascades to projects, cards, assets.",
    scope: "tenant",
    group: "Tenant",
  },
  {
    key: "members:read",
    label: "View members",
    description: "Read the tenant member list.",
    scope: "tenant",
    group: "Members",
  },
  {
    key: "members:invite",
    label: "Invite members",
    description: "Add an existing user to the tenant.",
    scope: "tenant",
    group: "Members",
  },
  {
    key: "members:update",
    label: "Change member roles",
    description: "Reassign tenant role for an existing member.",
    scope: "tenant",
    group: "Members",
  },
  {
    key: "members:remove",
    label: "Remove members",
    description: "Revoke tenant access from a member.",
    scope: "tenant",
    group: "Members",
  },
  {
    key: "projects:create",
    label: "Create projects",
    description: "Spin up a new project in this tenant.",
    scope: "tenant",
    group: "Projects",
  },
  {
    key: "projects:read",
    label: "List projects",
    description: "See projects in this tenant. Project-scoped data still requires project membership.",
    scope: "tenant",
    group: "Projects",
  },
  {
    key: "projects:delete",
    label: "Delete projects",
    description: "Cascades to cards, sets, etc.",
    scope: "tenant",
    group: "Projects",
  },
  {
    key: "billing:read",
    label: "View tenant billing",
    description: "See current plan and usage.",
    scope: "tenant",
    group: "Billing",
  },
  {
    key: "billing:update",
    label: "Change subscription",
    description: "Switch plans, update payment method.",
    scope: "tenant",
    group: "Billing",
  },
  {
    key: "plugins:read",
    label: "View installed plugins",
    description: "List what's installed.",
    scope: "tenant",
    group: "Plugins",
  },
  {
    key: "plugins:install",
    label: "Install plugins",
    description: "Install marketplace packages.",
    scope: "tenant",
    group: "Plugins",
  },
  {
    key: "plugins:uninstall",
    label: "Uninstall plugins",
    description: "Remove an installed plugin.",
    scope: "tenant",
    group: "Plugins",
  },
  {
    key: "brand:update",
    label: "Edit branding",
    description: "Change logo, colors, product name.",
    scope: "tenant",
    group: "Brand",
  },
  {
    key: "domains:read",
    label: "View custom domains",
    description: "List domains attached to this tenant.",
    scope: "tenant",
    group: "Domains",
  },
  {
    key: "domains:write",
    label: "Manage custom domains",
    description: "Add, verify, remove domains.",
    scope: "tenant",
    group: "Domains",
  },
  {
    key: "apikeys:read",
    label: "View API keys",
    description: "List active API keys (without their secrets).",
    scope: "tenant",
    group: "API",
  },
  {
    key: "apikeys:write",
    label: "Manage API keys",
    description: "Mint, revoke, and edit API keys.",
    scope: "tenant",
    group: "API",
  },
  {
    key: "webhooks:read",
    label: "View webhooks",
    description: "List webhook subscriptions.",
    scope: "tenant",
    group: "API",
  },
  {
    key: "webhooks:write",
    label: "Manage webhooks",
    description: "Create, edit, and delete webhook subscriptions.",
    scope: "tenant",
    group: "API",
  },
  {
    key: "audit:read",
    label: "View audit log",
    description: "Read the tenant audit trail.",
    scope: "tenant",
    group: "Audit",
  },
  {
    key: "cms:read",
    label: "View CMS",
    description: "Read public-site pages, navigations, forms.",
    scope: "tenant",
    group: "CMS",
  },
  {
    key: "cms:update",
    label: "Edit CMS",
    description: "Edit pages, blocks, navigations.",
    scope: "tenant",
    group: "CMS",
  },
  {
    key: "cms:publish",
    label: "Publish CMS pages",
    description: "Move pages from draft to published.",
    scope: "tenant",
    group: "CMS",
  },

  // ----- project scope -----------------------------------------------------
  {
    key: "project:read",
    label: "View project",
    description: "Read project metadata.",
    scope: "project",
    group: "Project",
  },
  {
    key: "project:update",
    label: "Edit project settings",
    description: "Rename, change status, change theme.",
    scope: "project",
    group: "Project",
  },
  {
    key: "cards:read",
    label: "View cards",
    description: "Read the card list.",
    scope: "project",
    group: "Cards",
  },
  {
    key: "cards:create",
    label: "Author cards",
    description: "Create new cards.",
    scope: "project",
    group: "Cards",
  },
  {
    key: "cards:update",
    label: "Edit cards",
    description: "Edit existing card data.",
    scope: "project",
    group: "Cards",
  },
  {
    key: "cards:delete",
    label: "Delete cards",
    description: "Remove cards.",
    scope: "project",
    group: "Cards",
  },
  {
    key: "cards:approve",
    label: "Approve cards",
    description: "Move cards through the review workflow.",
    scope: "project",
    group: "Cards",
  },
  {
    key: "cardtypes:read",
    label: "View card types",
    description: "Read card type templates and schemas.",
    scope: "project",
    group: "Card types",
  },
  {
    key: "cardtypes:write",
    label: "Edit card types",
    description: "Edit card type templates, schemas, and variants.",
    scope: "project",
    group: "Card types",
  },
  {
    key: "rules:read",
    label: "View rules",
    description: "Read rulesets, keywords.",
    scope: "project",
    group: "Rules",
  },
  {
    key: "rules:write",
    label: "Edit rules",
    description: "Edit rulesets, keywords, errata.",
    scope: "project",
    group: "Rules",
  },
  {
    key: "abilities:read",
    label: "View abilities",
    description: "Read ability graphs.",
    scope: "project",
    group: "Rules",
  },
  {
    key: "abilities:write",
    label: "Edit abilities",
    description: "Edit ability graphs.",
    scope: "project",
    group: "Rules",
  },
  {
    key: "assets:read",
    label: "View assets",
    description: "Read asset library.",
    scope: "project",
    group: "Assets",
  },
  {
    key: "assets:upload",
    label: "Upload assets",
    description: "Add new assets.",
    scope: "project",
    group: "Assets",
  },
  {
    key: "assets:delete",
    label: "Delete assets",
    description: "Remove assets.",
    scope: "project",
    group: "Assets",
  },
  {
    key: "sets:read",
    label: "View sets",
    description: "Read set/block/pack metadata.",
    scope: "project",
    group: "Sets",
  },
  {
    key: "sets:update",
    label: "Edit sets",
    description: "Edit sets, blocks, packs.",
    scope: "project",
    group: "Sets",
  },
  {
    key: "sets:publish",
    label: "Publish sets",
    description: "Mark sets as released.",
    scope: "project",
    group: "Sets",
  },
  {
    key: "exports:read",
    label: "View exports",
    description: "List previous export jobs and download outputs.",
    scope: "project",
    group: "Exports",
  },
  {
    key: "exports:create",
    label: "Run exports",
    description: "Kick off PDF/PNG/JSON exports.",
    scope: "project",
    group: "Exports",
  },
  {
    key: "playtest:read",
    label: "Join playtests",
    description: "View playtest sessions in read-only mode.",
    scope: "project",
    group: "Playtest",
  },
  {
    key: "playtest:write",
    label: "Run playtests",
    description: "Host and act in playtest sessions.",
    scope: "project",
    group: "Playtest",
  },
];

/** Group permissions by their `group` field for the picker UI. */
export function groupPermissions(scope: PermissionDef["scope"]): Record<string, PermissionDef[]> {
  const out: Record<string, PermissionDef[]> = {};
  for (const p of PERMISSION_CATALOG) {
    if (p.scope !== scope) continue;
    if (!out[p.group]) out[p.group] = [];
    out[p.group].push(p);
  }
  return out;
}

/**
 * Does the role grant the given permission? Wildcards expand:
 *   `*` grants any
 *   `tenants:*` grants every `tenants:`-prefixed permission
 *   exact match grants exactly itself
 */
export function permissionMatches(
  rolePermissions: ReadonlyArray<string>,
  required: string,
): boolean {
  for (const p of rolePermissions) {
    if (p === "*") return true;
    if (p === required) return true;
    if (p.endsWith(":*")) {
      const prefix = p.slice(0, -1); // keeps the trailing ":"
      if (required.startsWith(prefix)) return true;
    }
  }
  return false;
}
