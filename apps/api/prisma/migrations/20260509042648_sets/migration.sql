-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "setId" TEXT;

-- CreateTable
CREATE TABLE "Set" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "releaseDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Set_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Set_tenantId_idx" ON "Set"("tenantId");

-- CreateIndex
CREATE INDEX "Set_projectId_idx" ON "Set"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Set_projectId_code_key" ON "Set"("projectId", "code");

-- CreateIndex
CREATE INDEX "Card_setId_idx" ON "Card"("setId");

-- AddForeignKey
ALTER TABLE "Set" ADD CONSTRAINT "Set_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Set" ADD CONSTRAINT "Set_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
