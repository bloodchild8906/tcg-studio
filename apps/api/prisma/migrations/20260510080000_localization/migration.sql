-- AlterTable: tenant locales
ALTER TABLE "Tenant"
  ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN "supportedLocalesJson" JSONB NOT NULL DEFAULT '["en"]';

-- AlterTable: project locale overrides (nullable — inherit from tenant)
ALTER TABLE "Project"
  ADD COLUMN "defaultLocale" TEXT,
  ADD COLUMN "supportedLocalesJson" JSONB;

-- AlterTable: CMS page translations
ALTER TABLE "CmsPage"
  ADD COLUMN "translationsJson" JSONB NOT NULL DEFAULT '{}';
