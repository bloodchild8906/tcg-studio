-- Project-level theme/branding (sec 11.4 — branding inheritance).
-- Stored as JSON so we don't have to migrate every time a token gets
-- added (accent color, font, density, layout class). Null = inherit
-- from the tenant's brandingJson, which is the existing default.
ALTER TABLE "Project" ADD COLUMN "brandingJson" JSONB;

-- Platform-wide settings — singleton table. The platform admin
-- configures its own theme here; rows are keyed by id with a single
-- "default" row. Created with an empty branding blob so platform
-- callers can read it without first writing it.
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "brandingJson" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);
INSERT INTO "PlatformSetting" ("id", "brandingJson", "updatedAt")
VALUES ('default', '{}', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;
