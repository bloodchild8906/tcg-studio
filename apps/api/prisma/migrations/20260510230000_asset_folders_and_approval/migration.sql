-- Asset library upgrade (sec 20):
--   * AssetFolder — recursive folder tree for the file-explorer UI.
--   * Asset.folderId — assigns each asset to a folder (null = root).
--   * Asset.status / approvalNote / approvedBy / approvedAt — formal
--     approval workflow (sec 33). Card + template renderers gate on
--     status="approved" so unreviewed art doesn't leak into a release.
--
-- Existing assets are migrated as `status = 'approved'` so we don't
-- retroactively block in-flight projects from rendering. New uploads
-- default to 'draft'.

CREATE TABLE "AssetFolder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssetFolder_tenantId_parentId_slug_key"
    ON "AssetFolder"("tenantId", "parentId", "slug");
CREATE INDEX "AssetFolder_tenantId_projectId_idx"
    ON "AssetFolder"("tenantId", "projectId");
CREATE INDEX "AssetFolder_parentId_idx" ON "AssetFolder"("parentId");
ALTER TABLE "AssetFolder"
    ADD CONSTRAINT "AssetFolder_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AssetFolder_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "AssetFolder_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "AssetFolder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Asset"
    ADD COLUMN "folderId" TEXT,
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN "approvalNote" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "approvedBy" TEXT,
    ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Asset"
    ADD CONSTRAINT "Asset_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Asset_folderId_idx" ON "Asset"("folderId");
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- Backfill: existing assets are auto-approved so live projects don't
-- start rendering blank where art used to be.
UPDATE "Asset" SET "status" = 'approved', "approvedAt" = "createdAt"
WHERE "status" = 'draft';
