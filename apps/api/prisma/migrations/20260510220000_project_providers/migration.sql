-- Project-level email + storage providers (sec 43, sec 51).
-- Per the user's directive: "projects also need plugins, themes,
-- email, storage; tenants and platform don't need storage". So
-- storage is project-scope only. The Tenant.storageSettingsJson
-- column from the previous migration stays in the schema (dropping
-- it now would be destructive) but the UI no longer surfaces it;
-- it's effectively dead config until/unless we revive a tenant-
-- level storage tier later.
ALTER TABLE "Project"
    ADD COLUMN "emailSettingsJson"   JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "storageSettingsJson" JSONB NOT NULL DEFAULT '{}';
