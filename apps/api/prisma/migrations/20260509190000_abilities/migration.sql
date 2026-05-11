-- CreateTable
CREATE TABLE "Ability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'static',
    "text" TEXT NOT NULL DEFAULT '',
    "reminderText" TEXT NOT NULL DEFAULT '',
    "trigger" TEXT NOT NULL DEFAULT '',
    "cost" TEXT NOT NULL DEFAULT '',
    "keywordId" TEXT,
    "relatedCardIds" JSONB NOT NULL DEFAULT '[]',
    "graphJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ability_tenantId_idx" ON "Ability"("tenantId");

-- CreateIndex
CREATE INDEX "Ability_projectId_idx" ON "Ability"("projectId");

-- CreateIndex
CREATE INDEX "Ability_projectId_kind_idx" ON "Ability"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Ability_projectId_slug_key" ON "Ability"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "Ability" ADD CONSTRAINT "Ability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ability" ADD CONSTRAINT "Ability_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
