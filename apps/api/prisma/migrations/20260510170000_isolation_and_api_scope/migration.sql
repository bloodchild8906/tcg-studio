-- Database isolation tier (sec 10.3) — declares the policy now even
-- though the multi-DB routing in the prisma plugin lands later. v0
-- everyone stays on "shared" / "inherit"; enterprise tenants and
-- projects can flip to "schema" or "dedicated" once provisioning is
-- in place.
ALTER TABLE "Tenant"
  ADD COLUMN "databaseTier" TEXT NOT NULL DEFAULT 'shared',
  ADD COLUMN "databaseUrl" TEXT;

ALTER TABLE "Project"
  ADD COLUMN "databaseTier" TEXT NOT NULL DEFAULT 'inherit',
  ADD COLUMN "databaseUrl" TEXT;

-- Per-project API key scope (sec 36.7). A null projectId is a
-- tenant-wide key (existing behavior); a set projectId restricts the
-- key to that project's resources. Auth middleware enforces the
-- restriction at request time.
ALTER TABLE "ApiKey" ADD COLUMN "projectId" TEXT;
ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ApiKey_projectId_idx" ON "ApiKey"("projectId");
