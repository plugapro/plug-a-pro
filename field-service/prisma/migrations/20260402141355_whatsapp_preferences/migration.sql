-- CreateTable WhatsappPreferenceLog
CREATE TABLE "whatsapp_preference_logs" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" BOOLEAN NOT NULL,
    "newValue" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_preference_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_preference_logs_customerId_createdAt_idx" ON "whatsapp_preference_logs"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_preference_logs" ADD CONSTRAINT "whatsapp_preference_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
