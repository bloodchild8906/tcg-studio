-- Marketplace (sec 35).
-- Wraps Plugin authoring + asset packs + themes + starter kits behind a
-- single catalog the tenant browses. See schema.prisma comments for the
-- per-kind payload shape.

-- CreateTable: MarketplacePublisher
CREATE TABLE "MarketplacePublisher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT NOT NULL DEFAULT '',
    "websiteUrl" TEXT NOT NULL DEFAULT '',
    "iconAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePublisher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplacePublisher_tenantId_key" ON "MarketplacePublisher"("tenantId");
ALTER TABLE "MarketplacePublisher"
  ADD CONSTRAINT "MarketplacePublisher_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MarketplacePackage
CREATE TABLE "MarketplacePackage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT '',
    "publisherId" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "tenantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg10" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "iconAssetId" TEXT,
    "galleryJson" JSONB NOT NULL DEFAULT '[]',
    "tagsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplacePackage_slug_key" ON "MarketplacePackage"("slug");
CREATE INDEX "MarketplacePackage_scope_status_idx" ON "MarketplacePackage"("scope", "status");
CREATE INDEX "MarketplacePackage_kind_idx" ON "MarketplacePackage"("kind");
CREATE INDEX "MarketplacePackage_tenantId_idx" ON "MarketplacePackage"("tenantId");
CREATE INDEX "MarketplacePackage_publisherId_idx" ON "MarketplacePackage"("publisherId");
ALTER TABLE "MarketplacePackage"
  ADD CONSTRAINT "MarketplacePackage_publisherId_fkey"
  FOREIGN KEY ("publisherId") REFERENCES "MarketplacePublisher"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketplacePackage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MarketplacePackageVersion
CREATE TABLE "MarketplacePackageVersion" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT NOT NULL DEFAULT '',
    "contentJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplacePackageVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplacePackageVersion_packageId_version_key" ON "MarketplacePackageVersion"("packageId", "version");
CREATE INDEX "MarketplacePackageVersion_packageId_idx" ON "MarketplacePackageVersion"("packageId");
ALTER TABLE "MarketplacePackageVersion"
  ADD CONSTRAINT "MarketplacePackageVersion_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "MarketplacePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MarketplaceInstall
CREATE TABLE "MarketplaceInstall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "versionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settingsJson" JSONB NOT NULL DEFAULT '{}',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceInstall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplaceInstall_tenantId_packageId_key" ON "MarketplaceInstall"("tenantId", "packageId");
CREATE INDEX "MarketplaceInstall_tenantId_idx" ON "MarketplaceInstall"("tenantId");
CREATE INDEX "MarketplaceInstall_packageId_idx" ON "MarketplaceInstall"("packageId");
ALTER TABLE "MarketplaceInstall"
  ADD CONSTRAINT "MarketplaceInstall_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketplaceInstall_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "MarketplacePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MarketplaceReview
CREATE TABLE "MarketplaceReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplaceReview_packageId_userId_key" ON "MarketplaceReview"("packageId", "userId");
CREATE INDEX "MarketplaceReview_packageId_idx" ON "MarketplaceReview"("packageId");
CREATE INDEX "MarketplaceReview_tenantId_idx" ON "MarketplaceReview"("tenantId");
ALTER TABLE "MarketplaceReview"
  ADD CONSTRAINT "MarketplaceReview_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketplaceReview_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "MarketplacePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed a starter catalog so the marketplace browse view isn't empty on
-- a fresh install. Each row is deliberately small — production tenants
-- will replace these with real content. The package ids are stable so
-- repeat migrations don't duplicate.
INSERT INTO "MarketplacePackage"
  ("id", "slug", "name", "kind", "category", "summary", "description", "authorName", "scope", "status", "tagsJson", "updatedAt")
VALUES
  ('mkt_pkg_print_pro', 'print-export-pro', 'Print Export Pro', 'plugin', 'Production',
   'Pro print sheet exporter with bleed + crop + CMYK warnings.',
   'A more powerful PDF print exporter than the built-in. Adds bleed marks, configurable crop lines, sheet templates for common card stock sizes, and a CMYK-out-of-gamut warning.',
   'TCGStudio', 'platform', 'approved',
   '["pdf","print","exporter","production"]', CURRENT_TIMESTAMP),
  ('mkt_pkg_obsidian_theme', 'obsidian-cms-theme', 'Obsidian CMS Theme', 'cms_theme', 'Visuals',
   'Dark, professional theme for the public site.',
   'A studio-grade dark theme with gold accents. Includes a hero variant tuned for promo art, plus typography presets for fantasy and sci-fi card games.',
   'TCGStudio', 'platform', 'approved',
   '["theme","cms","dark","studio"]', CURRENT_TIMESTAMP),
  ('mkt_pkg_starter_fantasy', 'fantasy-starter-kit', 'Fantasy Starter Kit', 'starter_kit', 'Education',
   'A complete sample game with 60 cards across 4 factions.',
   'Drop-in starter content for a new tenant: card types, sample frames, faction art placeholders, a 60-card sample set, and a basic ruleset. Great for prototyping or teaching.',
   'TCGStudio', 'platform', 'approved',
   '["starter","fantasy","template","education"]', CURRENT_TIMESTAMP),
  ('mkt_pkg_pixel_frames', 'pixel-frame-pack', 'Pixel Frame Pack', 'frame_pack', 'Visuals',
   '12 retro pixel-art card frames.',
   'A retro-styled frame pack at 256×384 native resolution. Includes mono and dual-faction variants for fire/water/earth/wind, plus a neutral common frame.',
   'TCGStudio', 'platform', 'approved',
   '["frames","pixel","retro","art"]', CURRENT_TIMESTAMP),
  ('mkt_pkg_keyword_rules', 'classic-keyword-pack', 'Classic Keyword Pack', 'rules_pack', 'Rules',
   '20 reusable keywords with reminder text.',
   'Common card-game keywords (Swift, Ward N, Lifebind, Breakthrough, Steadfast, Guard, Rally, Anchor, Omen, Bloodied, ...) wired with rules text and validation hooks.',
   'TCGStudio', 'platform', 'approved',
   '["keywords","rules","mechanics"]', CURRENT_TIMESTAMP),
  ('mkt_pkg_tts_export', 'tts-export-deluxe', 'Tabletop Simulator Export Deluxe', 'exporter', 'Production',
   'TTS deck builder with custom backs and decklist export.',
   'Exports a full project to Tabletop Simulator with per-card custom backs, multi-deck saves, and deck list metadata. Ships as a TS-Module.',
   'TCGStudio', 'platform', 'approved',
   '["tts","tabletop","export"]', CURRENT_TIMESTAMP);

-- Seed a single version per package — the manifest is intentionally
-- minimal; the install handler swaps in real payloads as the platform
-- ships them.
INSERT INTO "MarketplacePackageVersion"
  ("id", "packageId", "version", "changelog", "contentJson", "status", "publishedAt")
VALUES
  ('mkt_ver_print_pro_001',     'mkt_pkg_print_pro',         '1.0.0', 'Initial release.',
   '{"manifest":{"id":"print-export-pro","name":"Print Export Pro","version":"1.0.0","permissions":["read:projects","read:cards","read:assets","write:exports"]}}',
   'approved', CURRENT_TIMESTAMP),
  ('mkt_ver_obsidian_001',      'mkt_pkg_obsidian_theme',    '1.0.0', 'Initial release.',
   '{"theme":{"name":"Obsidian","tokensJson":{"--accent":"#d4af37","--ink-950":"#0a0a0c"},"layoutJson":{}}}',
   'approved', CURRENT_TIMESTAMP),
  ('mkt_ver_fantasy_001',       'mkt_pkg_starter_fantasy',   '1.0.0', 'Initial release.',
   '{"project":{"name":"Sample Fantasy Game"},"cards":[],"sets":[]}',
   'approved', CURRENT_TIMESTAMP),
  ('mkt_ver_pixel_frames_001',  'mkt_pkg_pixel_frames',      '1.0.0', 'Initial release.',
   '{"assets":[]}',
   'approved', CURRENT_TIMESTAMP),
  ('mkt_ver_keyword_pack_001',  'mkt_pkg_keyword_rules',     '1.0.0', 'Initial release.',
   '{"keywords":[{"slug":"swift","name":"Swift","reminderText":"Acts the turn it enters."}]}',
   'approved', CURRENT_TIMESTAMP),
  ('mkt_ver_tts_deluxe_001',    'mkt_pkg_tts_export',        '1.0.0', 'Initial release.',
   '{"manifest":{"id":"tts-export-deluxe","name":"Tabletop Simulator Export Deluxe","version":"1.0.0","permissions":["read:projects","read:cards","read:assets","write:exports"]}}',
   'approved', CURRENT_TIMESTAMP);
