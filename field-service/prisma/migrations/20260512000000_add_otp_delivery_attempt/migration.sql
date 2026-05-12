-- OTP delivery telemetry. Additive: new table only.
-- Supabase Auth still owns OTP generation/storage/verification; this records
-- only the delivery wire (WhatsApp template send + outcome). Never store the
-- OTP value itself.

CREATE TABLE IF NOT EXISTS "otp_delivery_attempts" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "whatsappMessageId" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "templateName" TEXT,
    "hookRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "otp_delivery_attempts_phoneE164_createdAt_idx"
    ON "otp_delivery_attempts" ("phoneE164", "createdAt");

CREATE INDEX IF NOT EXISTS "otp_delivery_attempts_status_createdAt_idx"
    ON "otp_delivery_attempts" ("status", "createdAt");
