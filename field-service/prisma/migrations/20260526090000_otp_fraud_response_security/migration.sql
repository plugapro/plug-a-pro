-- OTP fraud response security layer.
-- Additive only: creates shadow challenge, event, and account security-state
-- tables while Supabase Auth remains the OTP authority.

DO $$
BEGIN
  CREATE TYPE "OtpPurpose" AS ENUM (
    'LOGIN',
    'SIGNUP',
    'BOOKING_CONFIRMATION',
    'PAYMENT_CONFIRMATION',
    'TECHNICIAN_ACCESS',
    'PROFILE_CHANGE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OtpChallengeStatus" AS ENUM (
    'REQUESTED',
    'SENT',
    'VERIFIED',
    'EXPIRED',
    'CANCELLED',
    'REPORTED_UNREQUESTED',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SecurityEventType" AS ENUM (
    'OTP_REPORTED_UNREQUESTED',
    'OTP_RATE_LIMIT_EXCEEDED',
    'OTP_VERIFICATION_FAILED_REPEATEDLY',
    'OTP_DELIVERY_REFUSED_DURING_LOCK',
    'ACCOUNT_LOCKED',
    'STEP_UP_COMPLETED',
    'LOCK_CLEARED_BY_ADMIN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SecuritySeverity" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SecurityEventStatus" AS ENUM (
    'NEW',
    'ACKNOWLEDGED',
    'RESOLVED',
    'FALSE_POSITIVE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SecuritySourceChannel" AS ENUM (
    'WHATSAPP_BUTTON',
    'PWA_LINK',
    'ADMIN',
    'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "otp_challenges" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "phoneE164" TEXT NOT NULL,
  "purpose" "OtpPurpose" NOT NULL,
  "codeHash" TEXT,
  "status" "OtpChallengeStatus" NOT NULL DEFAULT 'REQUESTED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "reportedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "provider" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "providerMessageId" TEXT,
  "requestedIpHash" TEXT,
  "requestedUserAgentHash" TEXT,
  "requestContext" JSONB NOT NULL DEFAULT '{}',
  "reportTokenHash" TEXT,
  "reportTokenUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "security_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "phoneE164" TEXT NOT NULL,
  "eventType" "SecurityEventType" NOT NULL,
  "severity" "SecuritySeverity" NOT NULL,
  "status" "SecurityEventStatus" NOT NULL DEFAULT 'NEW',
  "relatedOtpChallengeId" TEXT,
  "sourceChannel" "SecuritySourceChannel" NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_events_relatedOtpChallengeId_fkey"
    FOREIGN KEY ("relatedOtpChallengeId") REFERENCES "otp_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "account_security_states" (
  "id" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "userId" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "lockReason" TEXT,
  "stepUpRequired" BOOLEAN NOT NULL DEFAULT false,
  "stepUpSetAt" TIMESTAMP(3),
  "lastReportedAt" TIMESTAMP(3),
  "reportCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_security_states_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "otp_challenges_phoneE164_status_idx"
  ON "otp_challenges"("phoneE164", "status");
CREATE INDEX IF NOT EXISTS "otp_challenges_phoneE164_createdAt_idx"
  ON "otp_challenges"("phoneE164", "createdAt");
CREATE INDEX IF NOT EXISTS "otp_challenges_status_createdAt_idx"
  ON "otp_challenges"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "otp_challenges_userId_idx"
  ON "otp_challenges"("userId");

CREATE INDEX IF NOT EXISTS "security_events_status_createdAt_idx"
  ON "security_events"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "security_events_phoneE164_createdAt_idx"
  ON "security_events"("phoneE164", "createdAt");
CREATE INDEX IF NOT EXISTS "security_events_eventType_createdAt_idx"
  ON "security_events"("eventType", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "account_security_states_phoneE164_key"
  ON "account_security_states"("phoneE164");
CREATE INDEX IF NOT EXISTS "account_security_states_lockedUntil_idx"
  ON "account_security_states"("lockedUntil");

ALTER TABLE "public"."otp_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_security_states" ENABLE ROW LEVEL SECURITY;
