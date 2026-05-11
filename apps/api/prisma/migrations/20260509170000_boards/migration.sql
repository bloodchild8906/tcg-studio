-- CreateTable
CREATE TABLE "BoardLayout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "background" TEXT NOT NULL DEFAULT '#1a1d2a',
    "zonesJson" JSONB NOT NULL DEFAULT '[]',
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardLayout_tenantId_idx" ON "BoardLayout"("tenantId");

-- CreateIndex
CREATE INDEX "BoardLayout_projectId_idx" ON "BoardLayout"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardLayout_projectId_slug_key" ON "BoardLayout"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "BoardLayout" ADD CONSTRAINT "BoardLayout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardLayout" ADD CONSTRAINT "BoardLayout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
