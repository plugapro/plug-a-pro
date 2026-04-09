ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TABLE "inbound_whatsapp_messages" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "inbound_whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_whatsapp_messages_externalId_key" ON "inbound_whatsapp_messages"("externalId");
CREATE INDEX "inbound_whatsapp_messages_phone_firstSeenAt_idx" ON "inbound_whatsapp_messages"("phone", "firstSeenAt");

CREATE TABLE "onboarding_intakes" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "journey" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_intakes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboarding_intakes_phone_createdAt_idx" ON "onboarding_intakes"("phone", "createdAt");
CREATE INDEX "onboarding_intakes_status_createdAt_idx" ON "onboarding_intakes"("status", "createdAt");

-- Add direction column to message_events for inbound/outbound tracking
ALTER TABLE "message_events" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'OUTBOUND';
