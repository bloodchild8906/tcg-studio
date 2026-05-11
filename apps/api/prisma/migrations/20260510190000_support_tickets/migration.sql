-- Support tickets (sec 8). Hierarchical: project users → tenant
-- admins → platform support. The `routedTo` column captures where
-- the ticket lands so the queue endpoint can list "incoming" without
-- recomputing the route on every read.

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT,
    "routedTo" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "category" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicket_routedTo_status_idx" ON "SupportTicket"("routedTo", "status");
CREATE INDEX "SupportTicket_submitterId_idx" ON "SupportTicket"("submitterId");
CREATE INDEX "SupportTicket_tenantId_idx" ON "SupportTicket"("tenantId");
CREATE INDEX "SupportTicket_projectId_idx" ON "SupportTicket"("projectId");
ALTER TABLE "SupportTicket"
    ADD CONSTRAINT "SupportTicket_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "SupportTicket_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupportReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportReply_ticketId_idx" ON "SupportReply"("ticketId");
ALTER TABLE "SupportReply"
    ADD CONSTRAINT "SupportReply_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
