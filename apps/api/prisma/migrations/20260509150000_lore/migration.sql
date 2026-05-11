-- CreateTable
CREATE TABLE "Lore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'character',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "coverAssetId" TEXT,
    "factionId" TEXT,
    "setId" TEXT,
    "relationsJson" JSONB NOT NULL DEFAULT '[]',
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lore_tenantId_idx" ON "Lore"("tenantId");

-- CreateIndex
CREATE INDEX "Lore_projectId_idx" ON "Lore"("projectId");

-- CreateIndex
CREATE INDEX "Lore_projectId_kind_idx" ON "Lore"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Lore_projectId_slug_key" ON "Lore"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "Lore" ADD CONSTRAINT "Lore_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lore" ADD CONSTRAINT "Lore_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
