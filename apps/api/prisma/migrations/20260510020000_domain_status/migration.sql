-- AlterTable
ALTER TABLE "TenantDomain"
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "statusReason" TEXT;
