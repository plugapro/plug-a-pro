-- AlterTable: Tier 1 funnel observability — add providerId + leadId FKs to message_events
ALTER TABLE "message_events" ADD COLUMN "providerId" TEXT;
ALTER TABLE "message_events" ADD COLUMN "leadId" TEXT;

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "message_events_providerId_idx" ON "message_events"("providerId");

-- CreateIndex
CREATE INDEX "message_events_leadId_idx" ON "message_events"("leadId");
