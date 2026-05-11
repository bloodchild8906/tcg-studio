-- Tenant archetype (sec 8). Drives the dashboard preset, sidebar
-- grouping, and the recommended next-step prompts.
ALTER TABLE "Tenant"
  ADD COLUMN "tenantType" TEXT NOT NULL DEFAULT 'studio';
