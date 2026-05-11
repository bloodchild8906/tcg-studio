-- CreateTable
CREATE TABLE "VariantBadge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "iconAssetId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#d4a24c',
    "textColor" TEXT NOT NULL DEFAULT '#ffffff',
    "shape" TEXT NOT NULL DEFAULT 'rounded',
    "position" TEXT NOT NULL DEFAULT 'top_right',
    "conditionJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantBadge_tenantId_idx" ON "VariantBadge"("tenantId");

-- CreateIndex
CREATE INDEX "VariantBadge_projectId_idx" ON "VariantBadge"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantBadge_projectId_slug_key" ON "VariantBadge"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "VariantBadge" ADD CONSTRAINT "VariantBadge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantBadge" ADD CONSTRAINT "VariantBadge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
