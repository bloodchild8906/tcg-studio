-- Tenant email + storage provider config (sec 43, sec 51). Stored
-- as JSON so per-provider fields can grow without migrations.
-- Encrypted-at-rest for secrets (passwords, API keys) is handled by
-- the lib/secrets layer; the column itself is plain JSONB.
ALTER TABLE "Tenant"
    ADD COLUMN "emailSettingsJson"   JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "storageSettingsJson" JSONB NOT NULL DEFAULT '{}';

-- Invitations (sec 12.4). One table, three scopes:
--   * platform  → tenantId+projectId both null. Redeems by setting
--                 User.platformRole. Only platform admins can mint.
--   * tenant    → tenantId set. Redeems by creating a Membership.
--   * project   → both set. Redeems by creating a Membership (if
--                 missing) AND a ProjectMembership.
--
-- When the invitee already has an account the API skips this table
-- and creates the membership directly. The Invitation row only
-- exists for users who haven't signed up yet.
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_scope_status_idx"
    ON "Invitation"("scope", "status");
CREATE INDEX "Invitation_tenantId_status_idx"
    ON "Invitation"("tenantId", "status");
CREATE INDEX "Invitation_projectId_idx" ON "Invitation"("projectId");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
ALTER TABLE "Invitation"
    ADD CONSTRAINT "Invitation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "Invitation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
