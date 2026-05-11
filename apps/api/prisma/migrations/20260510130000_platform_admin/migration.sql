-- Platform admin role (sec 9.2 + 13.2) and the platform announcement
-- banner (sec 11 marketing surface). The role is null for ordinary
-- users; only the platform owner, admin, and support tiers see the
-- cross-tenant admin surfaces.

ALTER TABLE "User" ADD COLUMN "platformRole" TEXT;

CREATE TABLE "PlatformAnnouncement" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'info',
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformAnnouncement_status_idx" ON "PlatformAnnouncement"("status");

-- Promote the seeded demo user so the platform admin surface is
-- reachable out of the box. Production deploys will trim this and
-- assign the role manually.
UPDATE "User" SET "platformRole" = 'owner'
  WHERE "email" = 'michael@demo.tcgstudio.local';
