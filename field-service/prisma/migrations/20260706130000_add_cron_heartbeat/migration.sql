-- Audit OBS-09: cron heartbeat rows for dead-man detection.
-- Additive only - new table, no changes to existing objects.

-- CreateTable
CREATE TABLE "cron_heartbeats" (
    "id" TEXT NOT NULL,
    "cronKey" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cron_heartbeats_cronKey_key" ON "cron_heartbeats"("cronKey");

-- EnableRLS (deny-by-default: no policies; all access is server-side via Prisma)
ALTER TABLE "public"."cron_heartbeats" ENABLE ROW LEVEL SECURITY;
