-- Card revision history (sec 46).
-- Snapshot of a card's editable state at a point in time. Written by
-- the cards PATCH route before applying the new state, so every saved
-- edit becomes a restorable revision.

CREATE TABLE "CardVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "versionNum" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rarity" TEXT,
    "collectorNumber" INTEGER,
    "cardTypeId" TEXT NOT NULL,
    "setId" TEXT,
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CardVersion_cardId_versionNum_key" ON "CardVersion"("cardId", "versionNum");
CREATE INDEX "CardVersion_tenantId_idx" ON "CardVersion"("tenantId");
CREATE INDEX "CardVersion_cardId_idx" ON "CardVersion"("cardId");
ALTER TABLE "CardVersion"
  ADD CONSTRAINT "CardVersion_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
