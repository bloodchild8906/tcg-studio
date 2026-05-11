-- Project memberships (sec 13.4). A user MUST hold an explicit
-- ProjectMembership row to access a project's data — full stop. There
-- is no tenant-role bypass: a tenant_owner who isn't a project member
-- can't log in to the project. The route layer enforces this via the
-- assertProjectAccess helper; this table just stores the rows.
CREATE TABLE "ProjectMembership" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key"
    ON "ProjectMembership"("projectId", "userId");
CREATE INDEX "ProjectMembership_projectId_idx"
    ON "ProjectMembership"("projectId");
CREATE INDEX "ProjectMembership_userId_idx"
    ON "ProjectMembership"("userId");
ALTER TABLE "ProjectMembership"
    ADD CONSTRAINT "ProjectMembership_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: tenant owners / admins / project_creators of EXISTING
-- projects retain their access by being granted concrete
-- ProjectMembership rows. Without this they'd lose access to every
-- project on migration deploy because there's no bypass anymore.
-- This is a one-time migration of existing data; new projects from
-- here on must explicitly nominate an owner via the create-project
-- API, and tenant role does not grant access by itself.
--
-- Plain users (without owner/admin) don't get any memberships
-- backfilled — they'll need to be invited per project from now on,
-- which is the whole point of this migration.
INSERT INTO "ProjectMembership" ("id", "projectId", "userId", "role", "updatedAt")
SELECT
    'pm_' || substr(md5(random()::text || p.id || m."userId"), 1, 16),
    p.id,
    m."userId",
    CASE WHEN m.role = 'tenant_owner' THEN 'project_owner' ELSE 'game_designer' END,
    CURRENT_TIMESTAMP
FROM "Project" p
JOIN "Membership" m ON m."tenantId" = p."tenantId"
WHERE m.role IN ('tenant_owner', 'tenant_admin', 'project_creator')
ON CONFLICT ("projectId", "userId") DO NOTHING;
