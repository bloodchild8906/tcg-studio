-- Card comments + approval-flow markers (sec 18.4).
-- One row per comment; threaded one level deep via `parentId`.
-- Approval / change-request entries share this table so the timeline
-- is a single readable narrative instead of split between audit and
-- comments.

CREATE TABLE "CardComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "body" TEXT NOT NULL,
    "versionId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardComment_tenantId_idx" ON "CardComment"("tenantId");
CREATE INDEX "CardComment_cardId_idx" ON "CardComment"("cardId");
CREATE INDEX "CardComment_cardId_parentId_idx" ON "CardComment"("cardId", "parentId");
CREATE INDEX "CardComment_userId_idx" ON "CardComment"("userId");
ALTER TABLE "CardComment"
  ADD CONSTRAINT "CardComment_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
