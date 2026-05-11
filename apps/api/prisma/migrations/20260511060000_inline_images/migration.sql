-- Inline image columns — small whitelabel + profile images stored in postgres
-- rather than going through MinIO. Keeps brand assets self-contained on
-- the DB so disaster recovery is one backup instead of two systems.
--
-- The sibling `*MimeType` columns hold the content-type so the serving
-- endpoint doesn't have to guess from the bytes. All columns are nullable
-- and unset by default — existing rows keep their old asset-id references
-- (User.avatarAssetId, Tenant.brandingJson.logoAssetId) and the new
-- inline path takes priority only when an inline image has been uploaded.

ALTER TABLE "User"
  ADD COLUMN "avatarImage"     BYTEA,
  ADD COLUMN "avatarMimeType"  TEXT;

ALTER TABLE "Tenant"
  ADD COLUMN "logoImage"        BYTEA,
  ADD COLUMN "logoMimeType"     TEXT,
  ADD COLUMN "iconImage"        BYTEA,
  ADD COLUMN "iconMimeType"     TEXT,
  ADD COLUMN "faviconImage"     BYTEA,
  ADD COLUMN "faviconMimeType"  TEXT;
