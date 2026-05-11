-- CreateTable
CREATE TABLE "CmsSite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'studio',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "themeJson" JSONB NOT NULL DEFAULT '{}',
    "settingsJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsSite_tenantId_slug_key" ON "CmsSite"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "CmsSite_tenantId_idx" ON "CmsSite"("tenantId");

-- CreateIndex
CREATE INDEX "CmsSite_projectId_idx" ON "CmsSite"("projectId");

-- AddForeignKey
ALTER TABLE "CmsSite" ADD CONSTRAINT "CmsSite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsSite" ADD CONSTRAINT "CmsSite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CmsPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL DEFAULT '',
    "seoJson" JSONB NOT NULL DEFAULT '{}',
    "contentJson" JSONB NOT NULL DEFAULT '{"blocks":[]}',
    "publishedJson" JSONB NOT NULL DEFAULT '{"blocks":[]}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_siteId_slug_key" ON "CmsPage"("siteId", "slug");

-- CreateIndex
CREATE INDEX "CmsPage_tenantId_idx" ON "CmsPage"("tenantId");

-- CreateIndex
CREATE INDEX "CmsPage_siteId_idx" ON "CmsPage"("siteId");

-- CreateIndex
CREATE INDEX "CmsPage_status_idx" ON "CmsPage"("status");

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CmsSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CmsPageVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "versionNum" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL DEFAULT '{"blocks":[]}',
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsPageVersion_pageId_versionNum_key" ON "CmsPageVersion"("pageId", "versionNum");

-- CreateIndex
CREATE INDEX "CmsPageVersion_tenantId_idx" ON "CmsPageVersion"("tenantId");

-- CreateIndex
CREATE INDEX "CmsPageVersion_pageId_idx" ON "CmsPageVersion"("pageId");

-- AddForeignKey
ALTER TABLE "CmsPageVersion" ADD CONSTRAINT "CmsPageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CmsPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CmsNavigation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemsJson" JSONB NOT NULL DEFAULT '{"items":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsNavigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsNavigation_siteId_placement_key" ON "CmsNavigation"("siteId", "placement");

-- CreateIndex
CREATE INDEX "CmsNavigation_tenantId_idx" ON "CmsNavigation"("tenantId");

-- CreateIndex
CREATE INDEX "CmsNavigation_siteId_idx" ON "CmsNavigation"("siteId");

-- AddForeignKey
ALTER TABLE "CmsNavigation" ADD CONSTRAINT "CmsNavigation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CmsSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
