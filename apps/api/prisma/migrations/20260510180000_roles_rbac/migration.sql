-- Real RBAC (sec 13). Replaces the hardcoded enum-as-string with a
-- Role table that holds permission lists. Memberships still store
-- the role *slug*, but the slug now resolves to a permissions list
-- that the auth helpers check against.

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissionsJson" JSONB NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_scope_tenantId_slug_key"
    ON "Role"("scope", "tenantId", "slug");
CREATE INDEX "Role_scope_tenantId_idx" ON "Role"("scope", "tenantId");
ALTER TABLE "Role"
    ADD CONSTRAINT "Role_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed platform-scope built-in roles. tenantId is null so the unique
-- constraint stays clean. Permissions follow the dotted-namespace
-- convention from sec 13.6.
INSERT INTO "Role" ("id", "scope", "tenantId", "name", "slug", "description", "permissionsJson", "isSystem", "updatedAt")
VALUES
    ('role_platform_owner',  'platform', NULL, 'Owner',   'owner',
     'Full control of the platform — every permission, including granting other owners.',
     '["platform:*","tenants:*","billing:*","plans:*","announcements:*","admins:*"]'::jsonb,
     true, CURRENT_TIMESTAMP),
    ('role_platform_admin',  'platform', NULL, 'Admin',   'admin',
     'Manage tenants, billing, plans, and announcements. Can grant admin/support but not owner.',
     '["tenants:read","tenants:update","billing:read","billing:update","plans:read","plans:update","announcements:*","admins:read","admins:grant_admin","admins:grant_support","admins:revoke_non_owner"]'::jsonb,
     true, CURRENT_TIMESTAMP),
    ('role_platform_support', 'platform', NULL, 'Support', 'support',
     'Read-only access for support reps. See tenants, billing, and announcements but cannot mutate.',
     '["tenants:read","billing:read","plans:read","announcements:read","admins:read"]'::jsonb,
     true, CURRENT_TIMESTAMP)
ON CONFLICT ("scope", "tenantId", "slug") DO NOTHING;

-- Seed tenant-scope built-in roles, one row per tenant. The unique
-- index includes tenantId so the same `slug` can repeat across
-- tenants. Run a CROSS JOIN of (tenant × built-in role row) and
-- conflict-skip rows that already exist (so re-running this migration
-- on a partially-seeded DB is safe).
INSERT INTO "Role" ("id", "scope", "tenantId", "name", "slug", "description", "permissionsJson", "isSystem", "updatedAt")
SELECT
    'role_t_' || t.id || '_' || r.slug,
    'tenant',
    t.id,
    r.name,
    r.slug,
    r.description,
    r.perms::jsonb,
    true,
    CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (
    VALUES
        ('Tenant Owner',     'tenant_owner',
         'Full control of the workspace — billing, members, branding, plugins, and projects.',
         '["tenant:*","members:*","projects:*","billing:*","plugins:*","brand:*","domains:*","apikeys:*","webhooks:*","cms:*"]'),
        ('Tenant Admin',     'tenant_admin',
         'Manage members, projects, and most settings; cannot delete the tenant or grant ownership.',
         '["members:read","members:invite","members:update","projects:*","plugins:*","brand:update","domains:read","apikeys:*","webhooks:*","cms:*"]'),
        ('Billing Admin',    'billing_admin',
         'Manage subscription, plan changes, and payment methods.',
         '["billing:*","tenant:read","members:read"]'),
        ('Brand Manager',    'brand_manager',
         'Edit logo, colors, public-site theme, and white-label settings.',
         '["brand:*","cms:read","cms:update"]'),
        ('Domain Manager',   'domain_manager',
         'Add and verify custom domains.',
         '["domains:*","tenant:read"]'),
        ('Plugin Manager',   'plugin_manager',
         'Browse and install marketplace packages.',
         '["plugins:*","marketplace:read"]'),
        ('Security Admin',   'security_admin',
         'Manage API keys, webhooks, and audit retention.',
         '["apikeys:*","webhooks:*","audit:read","members:read"]'),
        ('Audit Viewer',     'audit_viewer',
         'Read-only access to the audit log.',
         '["audit:read","tenant:read"]'),
        ('Project Creator',  'project_creator',
         'Create new projects in this tenant. Does NOT confer access to existing projects.',
         '["projects:create","projects:read","tenant:read"]'),
        ('Viewer',           'viewer',
         'Read-only access to tenant metadata.',
         '["tenant:read","members:read"]')
) AS r(name, slug, description, perms)
ON CONFLICT ("scope", "tenantId", "slug") DO NOTHING;

-- Seed project-scope built-in roles, one set per tenant. Project
-- roles are shared across every project in the tenant — when a user
-- gets a `project_owner` ProjectMembership row, that slug resolves
-- through this Role table to find the permission list.
INSERT INTO "Role" ("id", "scope", "tenantId", "name", "slug", "description", "permissionsJson", "isSystem", "updatedAt")
SELECT
    'role_p_' || t.id || '_' || r.slug,
    'project',
    t.id,
    r.name,
    r.slug,
    r.description,
    r.perms::jsonb,
    true,
    CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (
    VALUES
        ('Project Owner',      'project_owner',
         'Full control of the project — members, settings, and all design tools.',
         '["project:*","cards:*","cardtypes:*","sets:*","decks:*","boards:*","rules:*","abilities:*","factions:*","lore:*","assets:*","exports:*","cms:*"]'),
        ('Project Admin',      'project_admin',
         'Manage everything except project deletion + ownership transfer.',
         '["project:read","project:update","cards:*","cardtypes:*","sets:*","decks:*","boards:*","rules:*","abilities:*","factions:*","lore:*","assets:*","exports:*","cms:*"]'),
        ('Game Designer',      'game_designer',
         'Edit cards, card types, rules, abilities, and assets.',
         '["cards:*","cardtypes:*","sets:read","sets:update","rules:*","abilities:*","assets:read","assets:upload"]'),
        ('Card Designer',      'card_designer',
         'Author cards.',
         '["cards:*","cardtypes:read","assets:read"]'),
        ('Template Designer',  'template_designer',
         'Edit card-type templates and visual layouts.',
         '["cardtypes:*","assets:read","assets:upload"]'),
        ('Rules Designer',     'rules_designer',
         'Edit rules, keywords, and rulesets.',
         '["rules:*","abilities:*"]'),
        ('Ability Designer',   'ability_designer',
         'Edit ability graphs.',
         '["abilities:*","cards:read"]'),
        ('Artist',             'artist',
         'Upload and manage assets.',
         '["assets:*","cards:read"]'),
        ('Writer',             'writer',
         'Edit lore, rules text, and flavor.',
         '["lore:*","cards:update","rules:read"]'),
        ('Set Manager',        'set_manager',
         'Manage sets, blocks, packs, and release pipelines.',
         '["sets:*","decks:read"]'),
        ('Export Manager',     'export_manager',
         'Run and manage exports + print profiles.',
         '["exports:*","cards:read","sets:read"]'),
        ('Playtester',         'playtester',
         'Read-only access to design data plus playtest sessions.',
         '["cards:read","sets:read","decks:*","boards:read","rulesets:read","playtest:*"]'),
        ('Viewer',             'viewer',
         'Read-only access to the project.',
         '["project:read","cards:read","sets:read","rules:read"]')
) AS r(name, slug, description, perms)
ON CONFLICT ("scope", "tenantId", "slug") DO NOTHING;
