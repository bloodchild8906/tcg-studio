-- CreateTable
CREATE TABLE "CmsForm" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "fieldsJson" JSONB NOT NULL DEFAULT '{"fields":[]}',
    "settingsJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsForm_siteId_slug_key" ON "CmsForm"("siteId", "slug");

-- CreateIndex
CREATE INDEX "CmsForm_tenantId_idx" ON "CmsForm"("tenantId");

-- CreateIndex
CREATE INDEX "CmsForm_siteId_idx" ON "CmsForm"("siteId");

-- AddForeignKey
ALTER TABLE "CmsForm" ADD CONSTRAINT "CmsForm_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CmsSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CmsFormSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CmsFormSubmission_tenantId_idx" ON "CmsFormSubmission"("tenantId");

-- CreateIndex
CREATE INDEX "CmsFormSubmission_formId_idx" ON "CmsFormSubmission"("formId");

-- CreateIndex
CREATE INDEX "CmsFormSubmission_createdAt_idx" ON "CmsFormSubmission"("createdAt");

-- AddForeignKey
ALTER TABLE "CmsFormSubmission" ADD CONSTRAINT "CmsFormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "CmsForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
