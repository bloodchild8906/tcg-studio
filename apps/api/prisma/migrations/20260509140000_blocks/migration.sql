-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#888888',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Block_tenantId_idx" ON "Block"("tenantId");

-- CreateIndex
CREATE INDEX "Block_projectId_idx" ON "Block"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_projectId_slug_key" ON "Block"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Set" ADD COLUMN "blockId" TEXT;

-- CreateIndex
CREATE INDEX "Set_blockId_idx" ON "Set"("blockId");

-- AddForeignKey
ALTER TABLE "Set" ADD CONSTRAINT "Set_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE SET NULL ON UPDATE CASCADE;
