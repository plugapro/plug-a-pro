-- WS-B.1: Admin CRUD base schema additions
-- Additive only — no renames, no drops.

-- ─── New enums ────────────────────────────────────────────────────────────────

CREATE TYPE "Role" AS ENUM ('OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER');

CREATE TYPE "CustomerInternalFlag" AS ENUM (
  'VIP',
  'FRAUD_RISK',
  'DISPUTE_HISTORY',
  'LATE_PAYMENT',
  'WATCHLIST',
  'LOYALTY_MEMBER'
);

CREATE TYPE "CustomerChannel" AS ENUM ('WHATSAPP', 'PWA', 'REFERRAL', 'IMPORT');

CREATE TYPE "KycStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED'
);

CREATE TYPE "ProviderStatus" AS ENUM (
  'APPLICATION_PENDING',
  'UNDER_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
  'BANNED'
);

-- ─── Extend Customer ──────────────────────────────────────────────────────────

ALTER TABLE "customers"
  ADD COLUMN "address"         TEXT,
  ADD COLUMN "isBlocked"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blockedReason"   TEXT,
  ADD COLUMN "blockedAt"       TIMESTAMP(3),
  ADD COLUMN "suspendedUntil"  TIMESTAMP(3),
  ADD COLUMN "suspendedReason" TEXT,
  ADD COLUMN "internalFlags"   "CustomerInternalFlag"[] NOT NULL DEFAULT ARRAY[]::"CustomerInternalFlag"[],
  ADD COLUMN "marketingOptIn"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "serviceOptIn"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "archivedAt"      TIMESTAMP(3),
  ADD COLUMN "archiveReason"   TEXT,
  ADD COLUMN "channel"         "CustomerChannel";

-- ─── Extend Provider ──────────────────────────────────────────────────────────

ALTER TABLE "providers"
  ADD COLUMN "status"           "ProviderStatus" NOT NULL DEFAULT 'APPLICATION_PENDING',
  ADD COLUMN "kycStatus"        "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "payoutVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedUntil"   TIMESTAMP(3),
  ADD COLUMN "suspendedReason"  TEXT,
  ADD COLUMN "strikes"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "archivedAt"       TIMESTAMP(3),
  ADD COLUMN "archiveReason"    TEXT;

-- ─── New model: FeatureFlag ───────────────────────────────────────────────────

CREATE TABLE "feature_flags" (
  "key"             TEXT NOT NULL,
  "enabled"         BOOLEAN NOT NULL DEFAULT false,
  "enabledForUsers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "description"     TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- ─── New model: AdminUser ─────────────────────────────────────────────────────

CREATE TABLE "admin_users" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "role"        "Role" NOT NULL DEFAULT 'OPS',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "invitedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invitedById" TEXT,
  "acceptedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_users_userId_key" ON "admin_users"("userId");
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "admin_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── New model: AdminAuditEvent ───────────────────────────────────────────────

CREATE TABLE "admin_audit_events" (
  "id"         TEXT NOT NULL,
  "adminId"    TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "metadata"   JSONB NOT NULL DEFAULT '{}',
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "timestamp"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_events_adminId_timestamp_idx" ON "admin_audit_events"("adminId", "timestamp");
CREATE INDEX "admin_audit_events_entityType_entityId_idx" ON "admin_audit_events"("entityType", "entityId");

ALTER TABLE "admin_audit_events"
  ADD CONSTRAINT "admin_audit_events_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── New model: CustomerNote ──────────────────────────────────────────────────

CREATE TABLE "customer_notes" (
  "id"         TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "pinned"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notes_customerId_createdAt_idx" ON "customer_notes"("customerId", "createdAt");

ALTER TABLE "customer_notes"
  ADD CONSTRAINT "customer_notes_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New model: ProviderNote ──────────────────────────────────────────────────

CREATE TABLE "provider_notes" (
  "id"         TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "pinned"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_notes_providerId_createdAt_idx" ON "provider_notes"("providerId", "createdAt");

ALTER TABLE "provider_notes"
  ADD CONSTRAINT "provider_notes_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New model: ProviderCertification ────────────────────────────────────────

CREATE TABLE "provider_certifications" (
  "id"               TEXT NOT NULL,
  "providerId"       TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "issuingAuthority" TEXT,
  "certNumber"       TEXT,
  "issuedAt"         TIMESTAMP(3),
  "expiresAt"        TIMESTAMP(3),
  "documentUrl"      TEXT,
  "verifiedAt"       TIMESTAMP(3),
  "verifiedById"     TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_certifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_certifications_providerId_idx" ON "provider_certifications"("providerId");

ALTER TABLE "provider_certifications"
  ADD CONSTRAINT "provider_certifications_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New model: ProviderEquipment ────────────────────────────────────────────

CREATE TABLE "provider_equipment" (
  "id"           TEXT NOT NULL,
  "providerId"   TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "category"     TEXT,
  "serialNumber" TEXT,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_equipment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_equipment_providerId_idx" ON "provider_equipment"("providerId");

ALTER TABLE "provider_equipment"
  ADD CONSTRAINT "provider_equipment_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
