-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "billingPeriod" TEXT NOT NULL DEFAULT 'free',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "limitsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- AlterTable: tenant fields
ALTER TABLE "Tenant"
  ADD COLUMN "planId" TEXT,
  ADD COLUMN "planSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Tenant_planId_idx" ON "Tenant"("planId");

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed plans. We insert the "free" tier and a couple of paid options
-- so a fresh install has something the tenant can attach to. Production
-- platforms will tweak / replace these via the admin route later.
INSERT INTO "Plan" ("id", "slug", "name", "description", "priceCents", "billingPeriod", "sortOrder", "status", "limitsJson", "updatedAt") VALUES
  ('plan_free',   'free',   'Free Creator',   'Perfect for trying the platform.',                          0,    'free',    10, 'active',
   '{"limits":{"projects":3,"members":2,"storageMiB":512,"exportsPerMonth":20,"customDomains":0,"apiKeys":1,"webhooks":0,"plugins":0},"features":{"whiteLabel":false,"sso":false,"advancedExports":false,"publicMarketplacePublishing":false}}',
   CURRENT_TIMESTAMP),
  ('plan_solo',   'solo',   'Solo Pro',       'For independent creators making real games.',               1900, 'monthly', 20, 'active',
   '{"limits":{"projects":10,"members":3,"storageMiB":5120,"exportsPerMonth":200,"customDomains":1,"apiKeys":3,"webhooks":3,"plugins":5},"features":{"whiteLabel":false,"sso":false,"advancedExports":true,"publicMarketplacePublishing":false}}',
   CURRENT_TIMESTAMP),
  ('plan_studio', 'studio', 'Studio',         'Small studios, full feature access.',                       7900, 'monthly', 30, 'active',
   '{"limits":{"projects":null,"members":10,"storageMiB":51200,"exportsPerMonth":2000,"customDomains":3,"apiKeys":10,"webhooks":10,"plugins":50},"features":{"whiteLabel":true,"sso":false,"advancedExports":true,"publicMarketplacePublishing":true}}',
   CURRENT_TIMESTAMP),
  ('plan_pub',    'publisher', 'Publisher',   'Multi-game studios with white-label needs.',                29900,'monthly', 40, 'active',
   '{"limits":{"projects":null,"members":50,"storageMiB":512000,"exportsPerMonth":null,"customDomains":null,"apiKeys":null,"webhooks":null,"plugins":null},"features":{"whiteLabel":true,"sso":true,"advancedExports":true,"publicMarketplacePublishing":true}}',
   CURRENT_TIMESTAMP);

-- Default existing tenants to the free plan.
UPDATE "Tenant" SET "planId" = 'plan_free' WHERE "planId" IS NULL;
