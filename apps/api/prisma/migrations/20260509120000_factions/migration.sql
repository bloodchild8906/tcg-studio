-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#888888',
    "iconAssetId" TEXT,
    "frameAssetId" TEXT,
    "mechanicsJson" JSONB NOT NULL DEFAULT '[]',
    "lore" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Faction_tenantId_idx" ON "Faction"("tenantId");

-- CreateIndex
CREATE INDEX "Faction_projectId_idx" ON "Faction"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Faction_projectId_slug_key" ON "Faction"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
