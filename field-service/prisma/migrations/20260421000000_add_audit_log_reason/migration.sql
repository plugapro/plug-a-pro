-- AlterTable: add reason column to audit_logs for human-readable justification
ALTER TABLE "audit_logs" ADD COLUMN "reason" TEXT;
