-- Repair production schema drift caused by historical Prisma migrations being
-- recorded as applied while their objects were absent. This migration is
-- intentionally idempotent: types, columns, tables, indexes, constraints, and
-- RLS enablement all no-op when the historical schema already exists.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderShortlistStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED', 'PUBLISHED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'SIGNUP', 'BOOKING_CONFIRMATION', 'PAYMENT_CONFIRMATION', 'TECHNICIAN_ACCESS', 'PROFILE_CHANGE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "OtpChallengeStatus" AS ENUM ('REQUESTED', 'SENT', 'VERIFIED', 'EXPIRED', 'CANCELLED', 'REPORTED_UNREQUESTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "SecurityEventType" AS ENUM ('OTP_REPORTED_UNREQUESTED', 'OTP_RATE_LIMIT_EXCEEDED', 'OTP_VERIFICATION_FAILED_REPEATEDLY', 'OTP_DELIVERY_REFUSED_DURING_LOCK', 'ACCOUNT_LOCKED', 'STEP_UP_COMPLETED', 'LOCK_CLEARED_BY_ADMIN', 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION', 'WEBHOOK_SIGNATURE_INVALID_REPEATED', 'IDENTITY_VERIFICATION_PILOT_BREACH');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "SecuritySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "SecurityEventStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "SecuritySourceChannel" AS ENUM ('WHATSAPP_BUTTON', 'PWA_LINK', 'ADMIN', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "LeadUnlockStatus" AS ENUM ('UNLOCKED', 'REFUNDED', 'DISPUTED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "LeadUnlockDisputeReason" AS ENUM ('INVALID_CUSTOMER_NUMBER', 'DUPLICATE_LEAD', 'WRONG_CATEGORY', 'WRONG_LOCATION', 'CUSTOMER_DID_NOT_REQUEST', 'CANCELLED_BEFORE_UNLOCK');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "LeadUnlockDisputeStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CompletionCheckStatus" AS ENUM ('SENT', 'YES', 'NO_RESCHEDULED', 'NO_NOT_FINISHED', 'NO_DIDNT_SHOW', 'ADMIN_FLAGGED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AssignmentMode" AS ENUM ('AUTO_ASSIGN', 'OPS_REVIEW');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "DispatchMode" AS ENUM ('AUTO_ASSIGN', 'OPS_REVIEW', 'MANUAL_OVERRIDE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "DispatchDecisionStatus" AS ENUM ('RANKED', 'OFFERING', 'ASSIGNED', 'NO_MATCH', 'OVERRIDDEN', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "MatchAttemptStage" AS ENUM ('FILTERED_OUT', 'RANKED', 'OFFERED', 'REJECTED', 'TIMED_OUT', 'ACCEPTED', 'SKIPPED', 'OVERRIDDEN');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AssignmentResponseOutcome" AS ENUM ('ACCEPTED', 'REJECTED', 'TIMED_OUT', 'EXPIRED', 'OVERRIDDEN', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AssignmentHoldStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'RELEASED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TechnicianCertificationStatus" AS ENUM ('SELF_DECLARED', 'EVIDENCE_UPLOADED', 'REVIEWED', 'VERIFIED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "LocationNodeType" AS ENUM ('PROVINCE', 'CITY', 'REGION', 'SUBURB');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TechnicianServiceAreaType" AS ENUM ('SUBURB', 'CITY', 'REGION', 'RADIUS', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TechnicianAvailabilityState" AS ENUM ('AVAILABLE', 'BUSY', 'PAUSED', 'OFFLINE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TechnicianScheduleItemType" AS ENUM ('BOOKING', 'BREAK', 'MANUAL_BLOCK', 'ASSIGNMENT_HOLD');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "TechnicianScheduleItemStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "OpsQueueType" AS ENUM ('VALIDATION', 'DISPATCH', 'QUOTE_APPROVAL', 'FIELD_EXCEPTION', 'DISPUTE', 'PAYMENT_FOLLOW_UP', 'PROVIDER_ONBOARDING', 'IDENTITY_VERIFICATION');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "PaymentCollectionMode" AS ENUM ('OFFLINE_RECORDED', 'PLATFORM_CHECKOUT');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "PaymentIntentMethod" AS ENUM ('MANUAL_EFT', 'PAYMENT_LINK', 'GATEWAY_CARD', 'GATEWAY_EFT', 'PAYAT', 'PAYFAST_CARD', 'PAYFAST_EFT', 'PAYFAST_SCODE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT', 'ITN_RECEIVED', 'CREDITED', 'CANCELLED', 'FAILED', 'EXPIRED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderWalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "WalletLedgerEntryType" AS ENUM ('TOPUP_CREDIT', 'PROMO_CREDIT', 'LEAD_UNLOCK_DEBIT', 'LEAD_REFUND_CREDIT', 'ADMIN_ADJUSTMENT', 'WALLET_SUSPENDED', 'WALLET_REACTIVATED', 'PROMO_EXPIRY', 'PAYMENT_REVERSAL', 'VOUCHER_REDEMPTION');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "WalletCreditType" AS ENUM ('PAID', 'PROMO');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderPromoAwardType" AS ENUM ('MOBILE_VERIFIED', 'PROFILE_COMPLETED', 'KYC_APPROVED', 'FIRST_TOPUP', 'FIRST_COMPLETED_JOB');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderPromoAwardStatus" AS ENUM ('AWARDED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VoucherRedemptionAttemptChannel" AS ENUM ('WHATSAPP', 'PWA');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VoucherRedemptionAttemptOutcome" AS ENUM ('SUCCESS', 'PARSE_FAILED', 'REDEMPTION_FAILED', 'RATE_LIMITED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VoucherRedemptionAttemptLengthBucket" AS ENUM ('EMPTY', 'TOO_SHORT', 'EXPECTED_SUFFIX', 'EXPECTED_WITH_PREFIX', 'TOO_LONG', 'OVERSIZE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VoucherRedemptionAttemptSeparatorBucket" AS ENUM ('NONE', 'DASH', 'WHITESPACE', 'DOT_OR_UNDERSCORE', 'UNICODE_DASH', 'INVISIBLE', 'MIXED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderAutoApproveSideEffectKind" AS ENUM ('PROMO_AWARD', 'NOTIFICATION', 'MATCH_RECHECK');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderAutoApproveSideEffectStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CaseState" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'REOPENED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CaseEntityType" AS ENUM ('JOB_REQUEST', 'MATCH', 'BOOKING', 'PAYMENT', 'DISPUTE', 'APPLICATION', 'QUOTE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CaseEventType" AS ENUM ('STATE_CHANGE', 'SYSTEM_EVENT', 'OPS_ACTION', 'NOTE_ADDED', 'ATTACHMENT_ADDED', 'ASSIGNMENT_CHANGE', 'CUSTOMER_CONTACTED', 'ESCALATION', 'BREACH_DETECTED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CaseNoteVisibility" AS ENUM ('INTERNAL_ONLY');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "Role" AS ENUM ('OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CustomerInternalFlag" AS ENUM ('VIP', 'FRAUD_RISK', 'DISPUTE_HISTORY', 'LATE_PAYMENT', 'WATCHLIST', 'LOYALTY_MEMBER');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CustomerChannel" AS ENUM ('WHATSAPP', 'PWA', 'REFERRAL', 'IMPORT');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "IdentityBasis" AS ENUM ('SA_ID', 'PASSPORT', 'REFUGEE_ID', 'ASYLUM_PERMIT', 'REFUGEE_PERMIT', 'WORK_PERMIT', 'PERMANENT_RESIDENCE_PERMIT');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "IdentityDocumentKind" AS ENUM ('ID_FRONT', 'ID_BACK', 'GREEN_ID_BOOK', 'PASSPORT_PHOTO_PAGE', 'VISA', 'WORK_PERMIT', 'ASYLUM_SEEKER_PERMIT_SECTION_22', 'REFUGEE_PERMIT_SECTION_24', 'REFUGEE_ID', 'SELFIE', 'LIVENESS_FRAME');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VerificationStatus" AS ENUM ('NOT_STARTED', 'STARTED', 'CONSENTED', 'AWAITING_IDENTIFIER', 'AWAITING_DOCUMENT', 'AWAITING_SELFIE', 'SUBMITTED', 'PROCESSING', 'AWAITING_LIVENESS', 'NEEDS_MANUAL_REVIEW', 'RETRY_REQUIRED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VerificationDecision" AS ENUM ('PASS', 'FAIL', 'MANUAL_REVIEW', 'RETRY_REQUIRED', 'PROVIDER_UNAVAILABLE');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VerificationChannel" AS ENUM ('PWA', 'WHATSAPP', 'ADMIN', 'VENDOR');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VerificationAssuranceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "VerificationDocumentStatus" AS ENUM ('UPLOADED', 'ACCEPTED', 'REJECTED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "SensitiveIdentityAccessType" AS ENUM ('VIEW_DOC', 'REVEAL_IDENTIFIER', 'SIGNED_URL_ISSUED', 'EXPORT');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "ProviderStatus" AS ENUM ('APPLICATION_PENDING', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BANNED');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CategoryRiskTier" AS ENUM ('LOW', 'STANDARD');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'MORE_INFO_REQUIRED';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "JobRequestStatus" ADD VALUE IF NOT EXISTS 'SHORTLIST_READY';
ALTER TYPE "JobRequestStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_CONFIRMATION_PENDING';
ALTER TYPE "JobRequestStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED_LOCKED';

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SEND_PENDING';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SEND_FAILED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'INTERESTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SHORTLISTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_SELECTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_ACCEPTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CREDIT_REQUIRED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CREDIT_APPLIED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED_LOCKED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "accessNotes" TEXT,
ADD COLUMN IF NOT EXISTS "addressLine1" TEXT,
ADD COLUMN IF NOT EXISTS "addressLine2" TEXT,
ADD COLUMN IF NOT EXISTS "complexName" TEXT,
ADD COLUMN IF NOT EXISTS "locationNodeId" TEXT,
ADD COLUMN IF NOT EXISTS "region" TEXT,
ADD COLUMN IF NOT EXISTS "unitNumber" TEXT;

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "caption" TEXT,
ADD COLUMN IF NOT EXISTS "providerApplicationId" TEXT,
ADD COLUMN IF NOT EXISTS "safeForPreview" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "isTestEvent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "reason" TEXT;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "scheduledEndAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "isTestSession" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "timeoutNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address" TEXT,
ADD COLUMN IF NOT EXISTS "archiveReason" TEXT,
ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "blockedReason" TEXT,
ADD COLUMN IF NOT EXISTS "businessName" TEXT,
ADD COLUMN IF NOT EXISTS "channel" TEXT,
ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "isBusinessAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "isTestUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "mergedIntoCustomerId" TEXT,
ADD COLUMN IF NOT EXISTS "purgeAfter" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "serviceOptIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT,
ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "extra_work" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "altSlotNegotiationOutcome" TEXT,
ADD COLUMN IF NOT EXISTS "altSlotNegotiationSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'AUTO_ASSIGN',
ADD COLUMN IF NOT EXISTS "autoCreateBookingOnAssignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "budgetPreference" TEXT,
ADD COLUMN IF NOT EXISTS "certifiedProviderRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "customerAcceptedAmount" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "customerAcceptedScope" TEXT,
ADD COLUMN IF NOT EXISTS "customerAccessToken" TEXT,
ADD COLUMN IF NOT EXISTS "customerAccessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "customerAccessTokenRevokedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "customerAddressId" TEXT,
ADD COLUMN IF NOT EXISTS "customerNoMatchNotifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "customerRematchCheckOutcome" TEXT,
ADD COLUMN IF NOT EXISTS "customerRematchCheckRespondedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "customerRematchCheckSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "enRouteWhatsappSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "estimatedDurationMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "isTestRequest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "latestDispatchDecisionId" TEXT,
ADD COLUMN IF NOT EXISTS "matchFoundWhatsappSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "maxCallOutFee" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "preferredProviderId" TEXT,
ADD COLUMN IF NOT EXISTS "providerPreference" TEXT,
ADD COLUMN IF NOT EXISTS "requestRef" TEXT,
ADD COLUMN IF NOT EXISTS "requestedArrivalLatest" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "requestedWindowEnd" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "requestedWindowStart" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "requiredCertificationCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "requiredEquipmentTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "requiredSkillTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "requiredVehicleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "riskLevel" TEXT,
ADD COLUMN IF NOT EXISTS "selectedLeadInviteId" TEXT,
ADD COLUMN IF NOT EXISTS "selectedProviderId" TEXT,
ADD COLUMN IF NOT EXISTS "source" TEXT,
ADD COLUMN IF NOT EXISTS "subcategory" TEXT,
ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "urgency" TEXT,
ADD COLUMN IF NOT EXISTS "verifiedOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "arrivalTimeConfirmedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "invoiceWhatsappSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "isTestJob" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "jobRef" TEXT,
ADD COLUMN IF NOT EXISTS "providerCurrentLat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "providerCurrentLng" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "providerLocationSharedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "runningLateWhatsappSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "scheduledArrivalAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "selectedLeadInviteId" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "assignmentHoldId" TEXT,
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "customerSelectedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "dispatchDecisionId" TEXT,
ADD COLUMN IF NOT EXISTS "expiredAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "isTestLead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "matchAttemptId" TEXT,
ADD COLUMN IF NOT EXISTS "matchScore" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "notificationAttemptedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerAcceptedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "rankingPosition" INTEGER,
ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "safePreviewToken" TEXT,
ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "completionCheckRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "completionCheckSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "completionCheckStatus" "CompletionCheckStatus",
ADD COLUMN IF NOT EXISTS "customerContactedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "plannedArrivalEnd" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "plannedArrivalNote" TEXT,
ADD COLUMN IF NOT EXISTS "plannedArrivalStart" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerArrivedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerCompletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerOnTheWayAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerStartedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewRequestSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message_events" ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "isTestEvent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "collectionMode" "PaymentCollectionMode" NOT NULL DEFAULT 'OFFLINE_RECORDED';

-- AlterTable
ALTER TABLE "provider_applications" ADD COLUMN IF NOT EXISTS "alternateMobileE164" VARCHAR(32),
ADD COLUMN IF NOT EXISTS "approvalWhatsappExternalId" TEXT,
ADD COLUMN IF NOT EXISTS "approvalWhatsappSendStartedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvalWhatsappSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "callOutFee" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "evidenceFileUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "evidenceNote" TEXT,
ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "isTestUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT,
ADD COLUMN IF NOT EXISTS "quoteAfterInspection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "rateNegotiable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "reference1Mobile" TEXT,
ADD COLUMN IF NOT EXISTS "reference1Name" TEXT,
ADD COLUMN IF NOT EXISTS "reference2Mobile" TEXT,
ADD COLUMN IF NOT EXISTS "reference2Name" TEXT,
ADD COLUMN IF NOT EXISTS "sameDayJobs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "weekendJobs" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "archiveReason" TEXT,
ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cancellationRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
ADD COLUMN IF NOT EXISTS "complaintCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "complaintRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "completedJobsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "equipmentTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "evidenceNote" TEXT,
ADD COLUMN IF NOT EXISTS "experience" TEXT,
ADD COLUMN IF NOT EXISTS "firstName" TEXT,
ADD COLUMN IF NOT EXISTS "isTestUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN IF NOT EXISTS "lastKnownLat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "lastKnownLng" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "lastKnownLocationAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastKnownLocationLabel" TEXT,
ADD COLUMN IF NOT EXISTS "lastName" TEXT,
ADD COLUMN IF NOT EXISTS "lateArrivalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "maxTravelMinutes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN IF NOT EXISTS "onTimeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "payoutVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "portfolioUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "providerCancellationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "providerType" TEXT,
ADD COLUMN IF NOT EXISTS "punctualityScore" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "strikes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT,
ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "vehicleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "whatsappMarketingOptIn" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "approvalWhatsappSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "matchId" TEXT,
ALTER COLUMN "jobId" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "suburb" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "locationNodeId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_members" (
    "id" TEXT NOT NULL,
    "principalCustomerId" TEXT NOT NULL,
    "memberUserId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "memberPhone" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BOOKER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "service_area_waitlist" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "category" TEXT,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_area_waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "location_nodes" (
    "id" TEXT NOT NULL,
    "nodeType" "LocationNodeType" NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION,
    "postalCode" TEXT,
    "provinceKey" TEXT,
    "cityKey" TEXT,
    "regionKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_unlocks" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "matchId" TEXT,
    "creditsCharged" INTEGER NOT NULL,
    "creditTypeBreakdown" JSONB NOT NULL DEFAULT '{}',
    "status" "LeadUnlockStatus" NOT NULL DEFAULT 'UNLOCKED',
    "isTestUnlock" BOOLEAN NOT NULL DEFAULT false,
    "cohortName" TEXT,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disputeReason" "LeadUnlockDisputeReason",
    "disputeNotes" TEXT,
    "disputedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "lead_unlock_disputes" (
    "id" TEXT NOT NULL,
    "leadUnlockId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "reason" "LeadUnlockDisputeReason" NOT NULL,
    "notes" TEXT,
    "status" "LeadUnlockDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "adminNotes" TEXT,

    CONSTRAINT "lead_unlock_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "booking_status_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "notes" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_categories" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "categorySlug" TEXT NOT NULL,
    "subServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yearsExperience" DOUBLE PRECISION,
    "skillLevel" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "certificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "certificationStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_rates" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "categorySlug" TEXT NOT NULL,
    "callOutFee" DECIMAL(10,2),
    "hourlyRate" DECIMAL(10,2),
    "dayRate" DECIMAL(10,2),
    "rateNegotiable" BOOLEAN NOT NULL DEFAULT true,
    "quoteAfterInspection" BOOLEAN NOT NULL DEFAULT false,
    "emergencySurcharge" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_lead_responses" (
    "id" TEXT NOT NULL,
    "leadInviteId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "callOutFee" DECIMAL(10,2),
    "estimatedArrivalAt" TIMESTAMP(3),
    "rateType" TEXT,
    "rateAmount" DECIMAL(10,2),
    "negotiable" BOOLEAN NOT NULL DEFAULT true,
    "providerNote" TEXT,
    "source" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_lead_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_lead_access_tokens" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "jobRequestId" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "provider_lead_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_shortlists" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "ProviderShortlistStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_shortlist_items" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "leadInviteId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "customerPreferenceRank" INTEGER,
    "matchScore" DOUBLE PRECISION,
    "displayCallOutFee" DECIMAL(10,2),
    "displayArrivalTime" TIMESTAMP(3),
    "customerSelectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_shortlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_identity_verifications" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "providerApplicationId" TEXT,
    "channel" "VerificationChannel" NOT NULL,
    "identityBasis" "IdentityBasis" NOT NULL,
    "issuingCountry" TEXT,
    "nationality" TEXT,
    "identifierHash" TEXT,
    "identifierLast4" TEXT,
    "identifierEncrypted" TEXT,
    "documentNumberHash" TEXT,
    "documentNumberLast4" TEXT,
    "documentExpiryDate" TIMESTAMP(3),
    "dobDerived" TIMESTAMP(3),
    "genderDerived" TEXT,
    "citizenshipDerived" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "decision" "VerificationDecision",
    "assuranceLevel" "VerificationAssuranceLevel" NOT NULL DEFAULT 'LOW',
    "riskFlags" JSONB,
    "failureReasonCode" TEXT,
    "providerNameComparisonResult" TEXT,
    "selfieMatchScore" DOUBLE PRECISION,
    "livenessScore" DOUBLE PRECISION,
    "documentConfidenceScore" DOUBLE PRECISION,
    "dhaMatchResult" TEXT,
    "immigrationStatusResult" TEXT,
    "sourceCheckProvider" TEXT,
    "vendorReference" TEXT,
    "vendorWorkflowId" TEXT,
    "costEstimateCents" INTEGER,
    "costCurrency" TEXT,
    "decisionAt" TIMESTAMP(3),
    "livenessSessionReference" TEXT,
    "livenessSessionUrlEncrypted" TEXT,
    "livenessSessionExpiresAt" TIMESTAMP(3),
    "consentVendorKey" TEXT,
    "consentVendorDisplayName" TEXT,
    "consentTextHash" TEXT,
    "rawPayloadRedacted" JSONB,
    "consentAcceptedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "auditLogReference" TEXT,
    "expiresAt" TIMESTAMP(3),
    "accessTokenHash" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "accessTokenLastUsedAt" TIMESTAMP(3),
    "accessTokenRevokedAt" TIMESTAMP(3),
    "countsTowardAttemptCap" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_identity_documents" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "documentKind" "IdentityDocumentKind" NOT NULL,
    "blobKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "VerificationDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_identity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_verification_events" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "fromStatus" "VerificationStatus",
    "toStatus" "VerificationStatus" NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "decision" "VerificationDecision",
    "reasonCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_verification_reviews" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "VerificationDecision" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_verification_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_sensitive_data_access_logs" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT,
    "documentId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "accessType" "SensitiveIdentityAccessType" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_sensitive_data_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_verification_webhook_events" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT,
    "vendorKey" TEXT NOT NULL,
    "vendorEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "vendorReference" TEXT,
    "livenessSessionReference" TEXT,
    "eventType" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "payloadHash" TEXT,
    "rawPayloadRedacted" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "provider_verification_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "verification_vendor_configs" (
    "vendorKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "livenessRequired" BOOLEAN NOT NULL DEFAULT true,
    "configJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_vendor_configs_pkey" PRIMARY KEY ("vendorKey")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_identity_verification_pilot_allowlist" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "providerApplicationId" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_identity_verification_pilot_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_identity_consent_events" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "vendorKey" TEXT NOT NULL,
    "vendorDisplayName" TEXT NOT NULL,
    "consentTextHash" TEXT NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedByProviderId" TEXT,
    "acceptedByApplicationId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "provider_identity_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_intents" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "creditsToIssue" INTEGER NOT NULL,
    "paymentMethod" "PaymentIntentMethod" NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "providerCellphone" TEXT,
    "gatewayReference" TEXT,
    "bankStatementReference" TEXT,
    "proofOfPaymentUrl" TEXT,
    "adminNote" TEXT,
    "itnReceivedAt" TIMESTAMP(3),
    "itnPaymentStatus" TEXT,
    "itnAmountCents" INTEGER,
    "creditedLedgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sourceReference" TEXT,
    "requestToPayId" INTEGER,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_wallets" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "paidCreditBalance" INTEGER NOT NULL DEFAULT 0,
    "promoCreditBalance" INTEGER NOT NULL DEFAULT 0,
    "status" "ProviderWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "entryType" "WalletLedgerEntryType" NOT NULL,
    "creditType" "WalletCreditType" NOT NULL,
    "amountCredits" INTEGER NOT NULL,
    "isTestTransaction" BOOLEAN NOT NULL DEFAULT false,
    "cohortName" TEXT,
    "balanceAfterPaidCredits" INTEGER NOT NULL,
    "balanceAfterPromoCredits" INTEGER NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "traceId" TEXT,
    "source" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_promo_awards" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "awardType" "ProviderPromoAwardType" NOT NULL,
    "creditsAwarded" INTEGER NOT NULL,
    "status" "ProviderPromoAwardStatus" NOT NULL DEFAULT 'AWARDED',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "provider_promo_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "voucher_batches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignCode" TEXT NOT NULL,
    "creditAmount" INTEGER NOT NULL DEFAULT 1,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "promo_vouchers" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditAmount" INTEGER NOT NULL DEFAULT 1,
    "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT NOT NULL,
    "redeemedByProviderId" TEXT,
    "redeemedByMobile" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_campaign_redemptions" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "campaignCode" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "creditAmount" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_campaign_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "voucher_redemption_attempts" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "channel" "VoucherRedemptionAttemptChannel" NOT NULL,
    "outcome" "VoucherRedemptionAttemptOutcome" NOT NULL,
    "redemptionErrorCode" TEXT,
    "parseFailureReason" TEXT,
    "normalizedLength" INTEGER NOT NULL,
    "normalizedLengthBucket" "VoucherRedemptionAttemptLengthBucket" NOT NULL,
    "hadPapPrefix" BOOLEAN NOT NULL,
    "separatorBucket" "VoucherRedemptionAttemptSeparatorBucket" NOT NULL,
    "separatorCount" INTEGER NOT NULL DEFAULT 0,
    "campaignCode" TEXT,
    "wouldRateLimit" BOOLEAN NOT NULL DEFAULT false,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_redemption_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_auto_approve_side_effect_markers" (
    "id" TEXT NOT NULL,
    "kind" "ProviderAutoApproveSideEffectKind" NOT NULL,
    "applicationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sourceRefType" TEXT NOT NULL,
    "sourceRefId" TEXT NOT NULL,
    "status" "ProviderAutoApproveSideEffectStatus" NOT NULL,
    "reason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "runId" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_auto_approve_side_effect_markers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "technician_skills" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "skillTag" TEXT NOT NULL,
    "proficiency" INTEGER,
    "yearsExperience" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "technician_certifications" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "certificationCode" TEXT NOT NULL,
    "certificationName" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "status" "TechnicianCertificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "evidenceUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "technician_service_areas" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "areaType" "TechnicianServiceAreaType" NOT NULL DEFAULT 'SUBURB',
    "label" TEXT NOT NULL,
    "city" TEXT,
    "province" TEXT,
    "locationNodeId" TEXT,
    "provinceKey" TEXT,
    "cityKey" TEXT,
    "regionKey" TEXT,
    "suburbKey" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "technician_availability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "availabilityMode" TEXT NOT NULL DEFAULT 'ALWAYS_AVAILABLE',
    "availabilityState" "TechnicianAvailabilityState" NOT NULL DEFAULT 'AVAILABLE',
    "nextAvailableAt" TIMESTAMP(3),
    "breakUntil" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
    "sameDayAvailable" BOOLEAN NOT NULL DEFAULT true,
    "weekendAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedBy" TEXT,
    "lastUpdatedChannel" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "technician_schedule_items" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "jobRequestId" TEXT,
    "assignmentHoldId" TEXT,
    "itemType" "TechnicianScheduleItemType" NOT NULL,
    "status" "TechnicianScheduleItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 15,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 15,
    "source" TEXT NOT NULL,
    "locationLabel" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dispatch_decisions" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "mode" "DispatchMode" NOT NULL,
    "status" "DispatchDecisionStatus" NOT NULL DEFAULT 'RANKED',
    "initiatedById" TEXT NOT NULL,
    "initiatedByRole" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "selectedProviderId" TEXT,
    "selectedMatchAttemptId" TEXT,
    "overrideReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "scoreWeights" JSONB NOT NULL DEFAULT '{}',
    "consideredCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "rankingSummary" JSONB,
    "filterSummary" JSONB,
    "explanation" TEXT,
    "alternativeSlotOptions" JSONB,
    "noMatchReason" TEXT,
    "stageCounts" JSONB,
    "failureClass" TEXT,
    "primaryReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "match_attempts" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "dispatchDecisionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "rankedPosition" INTEGER,
    "stage" "MatchAttemptStage" NOT NULL DEFAULT 'FILTERED_OUT',
    "hardFilterPassed" BOOLEAN NOT NULL DEFAULT false,
    "filteredReasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feasibilityNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "score" DOUBLE PRECISION,
    "scoreBreakdown" JSONB,
    "offeredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseOutcome" "AssignmentResponseOutcome",
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "assignment_holds" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "dispatchDecisionId" TEXT NOT NULL,
    "matchAttemptId" TEXT NOT NULL,
    "status" "AssignmentHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "outcomeReasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inbound_whatsapp_messages" (
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "ops_queue_assignments" (
    "id" TEXT NOT NULL,
    "queueType" "OpsQueueType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "claimedById" TEXT,
    "claimedByRole" TEXT,
    "claimedByLabel" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_queue_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "onboarding_intakes" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "security_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phoneE164" TEXT,
    "subjectVerificationId" TEXT,
    "subjectWebhookEventId" TEXT,
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

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledForUsers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cases" (
    "id" TEXT NOT NULL,
    "queueType" "OpsQueueType" NOT NULL,
    "entityType" "CaseEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "state" "CaseState" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "reasonCode" TEXT,
    "ownerUserId" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "case_events" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "CaseEventType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "case_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "CaseNoteVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_audit_events" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bookingOnAssignment" BOOLEAN NOT NULL DEFAULT false,
    "regulated" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "riskTier" "CategoryRiskTier" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "category_required_certifications" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_required_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "category_required_equipment" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_required_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "category_required_vehicle_types" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_required_vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_merge_events" (
    "id" TEXT NOT NULL,
    "sourceCustomerId" TEXT,
    "targetCustomerId" TEXT,
    "executedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_merge_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_notes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_notes" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" TEXT,
    "strikeDelta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_certifications" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "certNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "documentUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_equipment" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "serialNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_live_status" (
    "providerId" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "availabilityMode" TEXT NOT NULL DEFAULT 'OFFLINE',
    "activeJobCount" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastLocationLat" DOUBLE PRECISION,
    "lastLocationLng" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_live_status_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "candidate_pool" (
    "id" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "locationNodeId" TEXT,
    "provinceKey" TEXT,
    "providerId" TEXT NOT NULL,
    "scoreBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastRefreshed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_capacity" (
    "providerId" TEXT NOT NULL,
    "activeHolds" INTEGER NOT NULL DEFAULT 0,
    "activeJobs" INTEGER NOT NULL DEFAULT 0,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_capacity_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reason_codes" (
    "key" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requireNote" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "application_error_events" (
    "id" TEXT NOT NULL,
    "publicErrorRef" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "userId" TEXT,
    "providerApplicationId" TEXT,
    "whatsappPhoneHash" TEXT,
    "errorCode" TEXT NOT NULL,
    "errorCategory" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "userSafeMessage" TEXT NOT NULL,
    "technicalMessage" TEXT,
    "stackTrace" TEXT,
    "requestPayloadSummary" JSONB,
    "responsePayloadSummary" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "service_area_waitlist_city_idx" ON "service_area_waitlist"("city");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "service_area_waitlist_phone_city_key" ON "service_area_waitlist"("phone", "city");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "location_nodes_slug_key" ON "location_nodes"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "location_nodes_nodeType_active_idx" ON "location_nodes"("nodeType", "active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "location_nodes_provinceKey_nodeType_idx" ON "location_nodes"("provinceKey", "nodeType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "location_nodes_cityKey_nodeType_idx" ON "location_nodes"("cityKey", "nodeType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "location_nodes_regionKey_nodeType_idx" ON "location_nodes"("regionKey", "nodeType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_unlocks_leadId_key" ON "lead_unlocks"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_unlocks_providerId_unlockedAt_idx" ON "lead_unlocks"("providerId", "unlockedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_unlocks_matchId_idx" ON "lead_unlocks"("matchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_unlocks_isTestUnlock_idx" ON "lead_unlocks"("isTestUnlock");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lead_unlock_disputes_leadUnlockId_key" ON "lead_unlock_disputes"("leadUnlockId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_unlock_disputes_providerId_createdAt_idx" ON "lead_unlock_disputes"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_unlock_disputes_status_createdAt_idx" ON "lead_unlock_disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "booking_status_events_bookingId_idx" ON "booking_status_events"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_categories_categorySlug_approvalStatus_idx" ON "provider_categories"("categorySlug", "approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_categories_providerId_categorySlug_key" ON "provider_categories"("providerId", "categorySlug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_rates_categorySlug_idx" ON "provider_rates"("categorySlug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_rates_providerId_categorySlug_key" ON "provider_rates"("providerId", "categorySlug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_lead_responses_idempotencyKey_key" ON "provider_lead_responses"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_responses_leadInviteId_createdAt_idx" ON "provider_lead_responses"("leadInviteId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_responses_providerId_createdAt_idx" ON "provider_lead_responses"("providerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_lead_access_tokens_jti_key" ON "provider_lead_access_tokens"("jti");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_lead_access_tokens_tokenHash_key" ON "provider_lead_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_access_tokens_leadId_issuedAt_idx" ON "provider_lead_access_tokens"("leadId", "issuedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_access_tokens_providerId_issuedAt_idx" ON "provider_lead_access_tokens"("providerId", "issuedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_access_tokens_jobRequestId_idx" ON "provider_lead_access_tokens"("jobRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_access_tokens_expiresAt_idx" ON "provider_lead_access_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_lead_access_tokens_revokedAt_idx" ON "provider_lead_access_tokens"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlists_requestId_status_key" ON "provider_shortlists"("requestId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_shortlist_items_providerId_idx" ON "provider_shortlist_items"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlist_items_shortlistId_leadInviteId_key" ON "provider_shortlist_items"("shortlistId", "leadInviteId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_shortlist_items_shortlistId_providerId_key" ON "provider_shortlist_items"("shortlistId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_identity_verifications_accessTokenHash_key" ON "provider_identity_verifications"("accessTokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_identifierHash_idx" ON "provider_identity_verifications"("identifierHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_documentNumberHash_idx" ON "provider_identity_verifications"("documentNumberHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_status_createdAt_idx" ON "provider_identity_verifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_providerId_idx" ON "provider_identity_verifications"("providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_providerId_status_countsTow_idx" ON "provider_identity_verifications"("providerId", "status", "countsTowardAttemptCap");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_providerApplicationId_idx" ON "provider_identity_verifications"("providerApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_assuranceLevel_status_idx" ON "provider_identity_verifications"("assuranceLevel", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_sourceCheckProvider_vendorR_idx" ON "provider_identity_verifications"("sourceCheckProvider", "vendorReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_sourceCheckProvider_vendorW_idx" ON "provider_identity_verifications"("sourceCheckProvider", "vendorWorkflowId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_sourceCheckProvider_livenes_idx" ON "provider_identity_verifications"("sourceCheckProvider", "livenessSessionReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_documents_verificationId_idx" ON "provider_identity_documents"("verificationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_documents_deleteAfter_deletedAt_idx" ON "provider_identity_documents"("deleteAfter", "deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_documents_sha256_idx" ON "provider_identity_documents"("sha256");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_verification_events_verificationId_createdAt_idx" ON "provider_verification_events"("verificationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_verification_reviews_verificationId_createdAt_idx" ON "provider_verification_reviews"("verificationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_verification_reviews_reviewerId_createdAt_idx" ON "provider_verification_reviews"("reviewerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_sensitive_data_access_logs_verificationId_createdA_idx" ON "provider_sensitive_data_access_logs"("verificationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_sensitive_data_access_logs_documentId_createdAt_idx" ON "provider_sensitive_data_access_logs"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_sensitive_data_access_logs_actorId_createdAt_idx" ON "provider_sensitive_data_access_logs"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_verification_webhook_events_idempotencyKey_key" ON "provider_verification_webhook_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_verification_webhook_events_verificationId_receive_idx" ON "provider_verification_webhook_events"("verificationId", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_verification_webhook_events_vendorKey_vendorRefere_idx" ON "provider_verification_webhook_events"("vendorKey", "vendorReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_verification_webhook_events_vendorKey_livenessSess_idx" ON "provider_verification_webhook_events"("vendorKey", "livenessSessionReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verification_pilot_allowlist_providerId_idx" ON "provider_identity_verification_pilot_allowlist"("providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_verification_pilot_allowlist_providerAppl_idx" ON "provider_identity_verification_pilot_allowlist"("providerApplicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_consent_events_verificationId_acceptedAt_idx" ON "provider_identity_consent_events"("verificationId", "acceptedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_identity_consent_events_consentTextHash_idx" ON "provider_identity_consent_events"("consentTextHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_paymentReference_key" ON "payment_intents"("paymentReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_intents_providerId_createdAt_idx" ON "payment_intents"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_intents_status_createdAt_idx" ON "payment_intents"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_intents_bankStatementReference_idx" ON "payment_intents"("bankStatementReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_intents_sourceReference_idx" ON "payment_intents"("sourceReference");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_wallets_providerId_key" ON "provider_wallets"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_entries_idempotencyKey_key" ON "wallet_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_walletId_createdAt_idx" ON "wallet_ledger_entries"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_providerId_createdAt_idx" ON "wallet_ledger_entries"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_referenceType_referenceId_idx" ON "wallet_ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_isTestTransaction_createdAt_idx" ON "wallet_ledger_entries"("isTestTransaction", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_promo_awards_providerId_awardedAt_idx" ON "provider_promo_awards"("providerId", "awardedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_promo_awards_referenceType_referenceId_idx" ON "provider_promo_awards"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_promo_awards_providerId_awardType_key" ON "provider_promo_awards"("providerId", "awardType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "voucher_batches_campaignCode_key" ON "voucher_batches"("campaignCode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "promo_vouchers_codeHash_key" ON "promo_vouchers"("codeHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "promo_vouchers_status_idx" ON "promo_vouchers"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "promo_vouchers_batchId_idx" ON "promo_vouchers"("batchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "promo_vouchers_redeemedByProviderId_idx" ON "promo_vouchers"("redeemedByProviderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "promo_vouchers_redeemedByMobile_idx" ON "promo_vouchers"("redeemedByMobile");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "promo_vouchers_expiresAt_status_idx" ON "promo_vouchers"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_campaign_redemptions_voucherId_key" ON "provider_campaign_redemptions"("voucherId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_campaign_redemptions_campaignCode_idx" ON "provider_campaign_redemptions"("campaignCode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_campaign_redemptions_providerId_campaignCode_key" ON "provider_campaign_redemptions"("providerId", "campaignCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voucher_redemption_attempts_createdAt_idx" ON "voucher_redemption_attempts"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voucher_redemption_attempts_providerId_createdAt_idx" ON "voucher_redemption_attempts"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voucher_redemption_attempts_channel_outcome_createdAt_idx" ON "voucher_redemption_attempts"("channel", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voucher_redemption_attempts_parseFailureReason_createdAt_idx" ON "voucher_redemption_attempts"("parseFailureReason", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voucher_redemption_attempts_campaignCode_createdAt_idx" ON "voucher_redemption_attempts"("campaignCode", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_status_retry_idx" ON "provider_auto_approve_side_effect_markers"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_auto_approve_side_effect_markers_providerId_kind_idx" ON "provider_auto_approve_side_effect_markers"("providerId", "kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_appid_idx" ON "provider_auto_approve_side_effect_markers"("applicationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_auto_ae_markers_srctype_srcid_idx" ON "provider_auto_approve_side_effect_markers"("sourceRefType", "sourceRefId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_auto_approve_side_effect_markers_attemptedAt_idx" ON "provider_auto_approve_side_effect_markers"("attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_auto_ae_markers_kind_appid_key" ON "provider_auto_approve_side_effect_markers"("kind", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "technician_skills_providerId_skillTag_key" ON "technician_skills"("providerId", "skillTag");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "technician_certifications_providerId_certificationCode_key" ON "technician_certifications"("providerId", "certificationCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "technician_service_areas_providerId_active_idx" ON "technician_service_areas"("providerId", "active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "technician_service_areas_locationNodeId_idx" ON "technician_service_areas"("locationNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "technician_service_areas_provinceKey_idx" ON "technician_service_areas"("provinceKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "technician_service_areas_suburbKey_idx" ON "technician_service_areas"("suburbKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "technician_service_areas_providerId_locationNodeId_key" ON "technician_service_areas"("providerId", "locationNodeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "technician_availability_providerId_key" ON "technician_availability"("providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "technician_availability_availabilityMode_idx" ON "technician_availability"("availabilityMode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "technician_schedule_items_providerId_startAt_endAt_idx" ON "technician_schedule_items"("providerId", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_decisions_selectedMatchAttemptId_key" ON "dispatch_decisions"("selectedMatchAttemptId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_decisions_jobRequestId_createdAt_idx" ON "dispatch_decisions"("jobRequestId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_decisions_noMatchReason_createdAt_idx" ON "dispatch_decisions"("noMatchReason", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_decisions_failureClass_createdAt_idx" ON "dispatch_decisions"("failureClass", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_decisions_primaryReason_createdAt_idx" ON "dispatch_decisions"("primaryReason", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "match_attempts_jobRequestId_rankedPosition_idx" ON "match_attempts"("jobRequestId", "rankedPosition");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "match_attempts_dispatchDecisionId_providerId_key" ON "match_attempts"("dispatchDecisionId", "providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assignment_holds_jobRequestId_status_idx" ON "assignment_holds"("jobRequestId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assignment_holds_expiresAt_status_idx" ON "assignment_holds"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_whatsapp_messages_externalId_key" ON "inbound_whatsapp_messages"("externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbound_whatsapp_messages_phone_firstSeenAt_idx" ON "inbound_whatsapp_messages"("phone", "firstSeenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ops_queue_assignments_queueType_claimedById_idx" ON "ops_queue_assignments"("queueType", "claimedById");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ops_queue_assignments_queueType_entityId_key" ON "ops_queue_assignments"("queueType", "entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onboarding_intakes_phone_createdAt_idx" ON "onboarding_intakes"("phone", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onboarding_intakes_status_createdAt_idx" ON "onboarding_intakes"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_delivery_attempts_phoneE164_createdAt_idx" ON "otp_delivery_attempts"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_delivery_attempts_status_createdAt_idx" ON "otp_delivery_attempts"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_challenges_phoneE164_status_idx" ON "otp_challenges"("phoneE164", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_challenges_phoneE164_createdAt_idx" ON "otp_challenges"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_challenges_status_createdAt_idx" ON "otp_challenges"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_challenges_userId_idx" ON "otp_challenges"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "security_events_status_createdAt_idx" ON "security_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "security_events_phoneE164_createdAt_idx" ON "security_events"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "security_events_subjectVerificationId_idx" ON "security_events"("subjectVerificationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "security_events_subjectWebhookEventId_idx" ON "security_events"("subjectWebhookEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "security_events_eventType_createdAt_idx" ON "security_events"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_security_states_phoneE164_key" ON "account_security_states"("phoneE164");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_security_states_lockedUntil_idx" ON "account_security_states"("lockedUntil");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cases_queueType_state_slaDueAt_idx" ON "cases"("queueType", "state", "slaDueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cases_ownerUserId_state_idx" ON "cases"("ownerUserId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cases_entityId_idx" ON "cases"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cases_entityType_entityId_queueType_key" ON "cases"("entityType", "entityId", "queueType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_events_caseId_createdAt_idx" ON "case_events"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "case_notes_caseId_createdAt_idx" ON "case_notes"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_userId_key" ON "admin_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_audit_events_adminId_timestamp_idx" ON "admin_audit_events"("adminId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_audit_events_entityType_entityId_idx" ON "admin_audit_events"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "categories_active_sortOrder_idx" ON "categories"("active", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "category_required_certifications_code_idx" ON "category_required_certifications"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "category_required_certifications_categoryId_code_key" ON "category_required_certifications"("categoryId", "code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "category_required_equipment_tag_idx" ON "category_required_equipment"("tag");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "category_required_equipment_categoryId_tag_key" ON "category_required_equipment"("categoryId", "tag");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "category_required_vehicle_types_vehicleType_idx" ON "category_required_vehicle_types"("vehicleType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "category_required_vehicle_types_categoryId_vehicleType_key" ON "category_required_vehicle_types"("categoryId", "vehicleType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_merge_events_sourceCustomerId_createdAt_idx" ON "customer_merge_events"("sourceCustomerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_merge_events_targetCustomerId_createdAt_idx" ON "customer_merge_events"("targetCustomerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_notes_customerId_createdAt_idx" ON "customer_notes"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_notes_providerId_createdAt_idx" ON "provider_notes"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_certifications_providerId_idx" ON "provider_certifications"("providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_equipment_providerId_idx" ON "provider_equipment"("providerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_live_status_isOnline_idx" ON "provider_live_status"("isOnline");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_live_status_lastLocationLat_lastLocationLng_idx" ON "provider_live_status"("lastLocationLat", "lastLocationLng");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_pool_categorySlug_locationNodeId_idx" ON "candidate_pool"("categorySlug", "locationNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_pool_categorySlug_provinceKey_idx" ON "candidate_pool"("categorySlug", "provinceKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_pool_categorySlug_locationNodeId_providerId_key" ON "candidate_pool"("categorySlug", "locationNodeId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reason_codes_key_queueType_key" ON "reason_codes"("key", "queueType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "application_error_events_publicErrorRef_key" ON "application_error_events"("publicErrorRef");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "application_error_events_traceId_idx" ON "application_error_events"("traceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "application_error_events_errorCode_idx" ON "application_error_events"("errorCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "application_error_events_workflow_step_idx" ON "application_error_events"("workflow", "step");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "application_error_events_createdAt_idx" ON "application_error_events"("createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "addresses_locationNodeId_idx" ON "addresses"("locationNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_status_createdAt_idx" ON "bookings"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_matchId_idx" ON "bookings"("matchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "disputes_jobId_idx" ON "disputes"("jobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_bookingId_idx" ON "invoices"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_createdAt_idx" ON "invoices"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "job_requests_requestRef_key" ON "job_requests"("requestRef");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "job_requests_selectedLeadInviteId_key" ON "job_requests"("selectedLeadInviteId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "job_requests_customerAccessToken_key" ON "job_requests"("customerAccessToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_requests_status_createdAt_idx" ON "job_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_requests_isTestRequest_status_idx" ON "job_requests"("isTestRequest", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_status_events_jobId_idx" ON "job_status_events"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_jobRef_key" ON "jobs"("jobRef");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_selectedLeadInviteId_key" ON "jobs"("selectedLeadInviteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "jobs_status_createdAt_idx" ON "jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "jobs_providerId_status_idx" ON "jobs"("providerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "jobs_bookingId_idx" ON "jobs"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "leads_safePreviewToken_key" ON "leads"("safePreviewToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_jobRequestId_status_idx" ON "leads"("jobRequestId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_providerId_status_idx" ON "leads"("providerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_isTestLead_status_idx" ON "leads"("isTestLead", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "matches_jobRequestId_idx" ON "matches"("jobRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "matches_providerId_status_idx" ON "matches"("providerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "matches_status_createdAt_idx" ON "matches"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_events_idempotencyKey_idx" ON "message_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_bookingId_idx" ON "payments"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_pspProvider_pspCheckoutId_idx" ON "payments"("pspProvider", "pspCheckoutId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_applications_approvalWhatsappSentAt_idx" ON "provider_applications"("approvalWhatsappSentAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_applications_isTestUser_status_idx" ON "provider_applications"("isTestUser", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_applications_status_submittedAt_idx" ON "provider_applications"("status", "submittedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_payouts_status_createdAt_idx" ON "provider_payouts"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_payouts_providerId_createdAt_idx" ON "provider_payouts"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "providers_active_verified_idx" ON "providers"("active", "verified");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "providers_isTestUser_idx" ON "providers"("isTestUser");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "providers_status_createdAt_idx" ON "providers"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "providers_kycStatus_status_idx" ON "providers"("kycStatus", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "providers_completedJobsCount_idx" ON "providers"("completedJobsCount");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quotes_matchId_idx" ON "quotes"("matchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quotes_status_createdAt_idx" ON "quotes"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_matchId_reviewerType_key" ON "reviews"("matchId", "reviewerType");

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- AddForeignKey

-- Add foreign-key constraints only when they are absent so this repair remains
-- safe on fresh databases that already applied the historical migrations.
CREATE OR REPLACE FUNCTION _plugapro_add_constraint_if_missing(constraint_name text, ddl text)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = constraint_name
  ) THEN
    EXECUTE ddl;
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT _plugapro_add_constraint_if_missing('addresses_locationNodeId_fkey', 'ALTER TABLE "addresses" ADD CONSTRAINT "addresses_locationNodeId_fkey" FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('customer_addresses_customerId_fkey', 'ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('customer_addresses_locationNodeId_fkey', 'ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_locationNodeId_fkey" FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('customer_members_principalCustomerId_fkey', 'ALTER TABLE "customer_members" ADD CONSTRAINT "customer_members_principalCustomerId_fkey" FOREIGN KEY ("principalCustomerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('location_nodes_parentId_fkey', 'ALTER TABLE "location_nodes" ADD CONSTRAINT "location_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('job_requests_preferredProviderId_fkey', 'ALTER TABLE "job_requests" ADD CONSTRAINT "job_requests_preferredProviderId_fkey" FOREIGN KEY ("preferredProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('job_requests_selectedProviderId_fkey', 'ALTER TABLE "job_requests" ADD CONSTRAINT "job_requests_selectedProviderId_fkey" FOREIGN KEY ("selectedProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('job_requests_selectedLeadInviteId_fkey', 'ALTER TABLE "job_requests" ADD CONSTRAINT "job_requests_selectedLeadInviteId_fkey" FOREIGN KEY ("selectedLeadInviteId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('leads_dispatchDecisionId_fkey', 'ALTER TABLE "leads" ADD CONSTRAINT "leads_dispatchDecisionId_fkey" FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('leads_matchAttemptId_fkey', 'ALTER TABLE "leads" ADD CONSTRAINT "leads_matchAttemptId_fkey" FOREIGN KEY ("matchAttemptId") REFERENCES "match_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('leads_assignmentHoldId_fkey', 'ALTER TABLE "leads" ADD CONSTRAINT "leads_assignmentHoldId_fkey" FOREIGN KEY ("assignmentHoldId") REFERENCES "assignment_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('lead_unlocks_leadId_fkey', 'ALTER TABLE "lead_unlocks" ADD CONSTRAINT "lead_unlocks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('lead_unlocks_providerId_fkey', 'ALTER TABLE "lead_unlocks" ADD CONSTRAINT "lead_unlocks_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('lead_unlocks_matchId_fkey', 'ALTER TABLE "lead_unlocks" ADD CONSTRAINT "lead_unlocks_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('lead_unlock_disputes_leadUnlockId_fkey', 'ALTER TABLE "lead_unlock_disputes" ADD CONSTRAINT "lead_unlock_disputes_leadUnlockId_fkey" FOREIGN KEY ("leadUnlockId") REFERENCES "lead_unlocks"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('lead_unlock_disputes_providerId_fkey', 'ALTER TABLE "lead_unlock_disputes" ADD CONSTRAINT "lead_unlock_disputes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('booking_status_events_bookingId_fkey', 'ALTER TABLE "booking_status_events" ADD CONSTRAINT "booking_status_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('jobs_selectedLeadInviteId_fkey', 'ALTER TABLE "jobs" ADD CONSTRAINT "jobs_selectedLeadInviteId_fkey" FOREIGN KEY ("selectedLeadInviteId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_categories_providerId_fkey', 'ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_categories_categoryId_fkey', 'ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_rates_providerId_fkey', 'ALTER TABLE "provider_rates" ADD CONSTRAINT "provider_rates_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_rates_categoryId_fkey', 'ALTER TABLE "provider_rates" ADD CONSTRAINT "provider_rates_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_lead_responses_leadInviteId_fkey', 'ALTER TABLE "provider_lead_responses" ADD CONSTRAINT "provider_lead_responses_leadInviteId_fkey" FOREIGN KEY ("leadInviteId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_lead_responses_providerId_fkey', 'ALTER TABLE "provider_lead_responses" ADD CONSTRAINT "provider_lead_responses_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_lead_access_tokens_leadId_fkey', 'ALTER TABLE "provider_lead_access_tokens" ADD CONSTRAINT "provider_lead_access_tokens_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_lead_access_tokens_providerId_fkey', 'ALTER TABLE "provider_lead_access_tokens" ADD CONSTRAINT "provider_lead_access_tokens_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_lead_access_tokens_jobRequestId_fkey', 'ALTER TABLE "provider_lead_access_tokens" ADD CONSTRAINT "provider_lead_access_tokens_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_shortlists_requestId_fkey', 'ALTER TABLE "provider_shortlists" ADD CONSTRAINT "provider_shortlists_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_shortlist_items_shortlistId_fkey', 'ALTER TABLE "provider_shortlist_items" ADD CONSTRAINT "provider_shortlist_items_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "provider_shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_shortlist_items_leadInviteId_fkey', 'ALTER TABLE "provider_shortlist_items" ADD CONSTRAINT "provider_shortlist_items_leadInviteId_fkey" FOREIGN KEY ("leadInviteId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_shortlist_items_providerId_fkey', 'ALTER TABLE "provider_shortlist_items" ADD CONSTRAINT "provider_shortlist_items_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('attachments_providerApplicationId_fkey', 'ALTER TABLE "attachments" ADD CONSTRAINT "attachments_providerApplicationId_fkey" FOREIGN KEY ("providerApplicationId") REFERENCES "provider_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_identity_verifications_providerId_fkey', 'ALTER TABLE "provider_identity_verifications" ADD CONSTRAINT "provider_identity_verifications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_identity_verifications_providerApplicationId_fkey', 'ALTER TABLE "provider_identity_verifications" ADD CONSTRAINT "provider_identity_verifications_providerApplicationId_fkey" FOREIGN KEY ("providerApplicationId") REFERENCES "provider_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_identity_documents_verificationId_fkey', 'ALTER TABLE "provider_identity_documents" ADD CONSTRAINT "provider_identity_documents_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_verification_events_verificationId_fkey', 'ALTER TABLE "provider_verification_events" ADD CONSTRAINT "provider_verification_events_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_verification_reviews_verificationId_fkey', 'ALTER TABLE "provider_verification_reviews" ADD CONSTRAINT "provider_verification_reviews_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_sensitive_data_access_logs_verificationId_fkey', 'ALTER TABLE "provider_sensitive_data_access_logs" ADD CONSTRAINT "provider_sensitive_data_access_logs_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_sensitive_data_access_logs_documentId_fkey', 'ALTER TABLE "provider_sensitive_data_access_logs" ADD CONSTRAINT "provider_sensitive_data_access_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "provider_identity_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_verification_webhook_events_verificationId_fkey', 'ALTER TABLE "provider_verification_webhook_events" ADD CONSTRAINT "provider_verification_webhook_events_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_identity_verification_pilot_allowlist_providerId_fkey', 'ALTER TABLE "provider_identity_verification_pilot_allowlist" ADD CONSTRAINT "provider_identity_verification_pilot_allowlist_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_identity_verification_pilot_allowlist_providerApp_fkey', 'ALTER TABLE "provider_identity_verification_pilot_allowlist" ADD CONSTRAINT "provider_identity_verification_pilot_allowlist_providerApp_fkey" FOREIGN KEY ("providerApplicationId") REFERENCES "provider_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_identity_consent_events_verificationId_fkey', 'ALTER TABLE "provider_identity_consent_events" ADD CONSTRAINT "provider_identity_consent_events_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('payment_intents_providerId_fkey', 'ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_wallets_providerId_fkey', 'ALTER TABLE "provider_wallets" ADD CONSTRAINT "provider_wallets_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('wallet_ledger_entries_walletId_fkey', 'ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "provider_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('wallet_ledger_entries_providerId_fkey', 'ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_promo_awards_providerId_fkey', 'ALTER TABLE "provider_promo_awards" ADD CONSTRAINT "provider_promo_awards_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('voucher_batches_createdById_fkey', 'ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('promo_vouchers_batchId_fkey', 'ALTER TABLE "promo_vouchers" ADD CONSTRAINT "promo_vouchers_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "voucher_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('promo_vouchers_redeemedByProviderId_fkey', 'ALTER TABLE "promo_vouchers" ADD CONSTRAINT "promo_vouchers_redeemedByProviderId_fkey" FOREIGN KEY ("redeemedByProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_campaign_redemptions_providerId_fkey', 'ALTER TABLE "provider_campaign_redemptions" ADD CONSTRAINT "provider_campaign_redemptions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_campaign_redemptions_voucherId_fkey', 'ALTER TABLE "provider_campaign_redemptions" ADD CONSTRAINT "provider_campaign_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "promo_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('voucher_redemption_attempts_providerId_fkey', 'ALTER TABLE "voucher_redemption_attempts" ADD CONSTRAINT "voucher_redemption_attempts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_auto_approve_side_effect_markers_providerId_fkey', 'ALTER TABLE "provider_auto_approve_side_effect_markers" ADD CONSTRAINT "provider_auto_approve_side_effect_markers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_skills_providerId_fkey', 'ALTER TABLE "technician_skills" ADD CONSTRAINT "technician_skills_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_certifications_providerId_fkey', 'ALTER TABLE "technician_certifications" ADD CONSTRAINT "technician_certifications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_service_areas_providerId_fkey', 'ALTER TABLE "technician_service_areas" ADD CONSTRAINT "technician_service_areas_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_service_areas_locationNodeId_fkey', 'ALTER TABLE "technician_service_areas" ADD CONSTRAINT "technician_service_areas_locationNodeId_fkey" FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_availability_providerId_fkey', 'ALTER TABLE "technician_availability" ADD CONSTRAINT "technician_availability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_schedule_items_providerId_fkey', 'ALTER TABLE "technician_schedule_items" ADD CONSTRAINT "technician_schedule_items_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_schedule_items_bookingId_fkey', 'ALTER TABLE "technician_schedule_items" ADD CONSTRAINT "technician_schedule_items_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_schedule_items_jobRequestId_fkey', 'ALTER TABLE "technician_schedule_items" ADD CONSTRAINT "technician_schedule_items_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('technician_schedule_items_assignmentHoldId_fkey', 'ALTER TABLE "technician_schedule_items" ADD CONSTRAINT "technician_schedule_items_assignmentHoldId_fkey" FOREIGN KEY ("assignmentHoldId") REFERENCES "assignment_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('dispatch_decisions_jobRequestId_fkey', 'ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('dispatch_decisions_selectedProviderId_fkey', 'ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_selectedProviderId_fkey" FOREIGN KEY ("selectedProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('dispatch_decisions_selectedMatchAttemptId_fkey', 'ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_selectedMatchAttemptId_fkey" FOREIGN KEY ("selectedMatchAttemptId") REFERENCES "match_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('match_attempts_jobRequestId_fkey', 'ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('match_attempts_providerId_fkey', 'ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('match_attempts_dispatchDecisionId_fkey', 'ALTER TABLE "match_attempts" ADD CONSTRAINT "match_attempts_dispatchDecisionId_fkey" FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('assignment_holds_jobRequestId_fkey', 'ALTER TABLE "assignment_holds" ADD CONSTRAINT "assignment_holds_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('assignment_holds_providerId_fkey', 'ALTER TABLE "assignment_holds" ADD CONSTRAINT "assignment_holds_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('assignment_holds_dispatchDecisionId_fkey', 'ALTER TABLE "assignment_holds" ADD CONSTRAINT "assignment_holds_dispatchDecisionId_fkey" FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('assignment_holds_matchAttemptId_fkey', 'ALTER TABLE "assignment_holds" ADD CONSTRAINT "assignment_holds_matchAttemptId_fkey" FOREIGN KEY ("matchAttemptId") REFERENCES "match_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('reviews_matchId_fkey', 'ALTER TABLE "reviews" ADD CONSTRAINT "reviews_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('security_events_relatedOtpChallengeId_fkey', 'ALTER TABLE "security_events" ADD CONSTRAINT "security_events_relatedOtpChallengeId_fkey" FOREIGN KEY ("relatedOtpChallengeId") REFERENCES "otp_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('security_events_subjectVerificationId_fkey', 'ALTER TABLE "security_events" ADD CONSTRAINT "security_events_subjectVerificationId_fkey" FOREIGN KEY ("subjectVerificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('security_events_subjectWebhookEventId_fkey', 'ALTER TABLE "security_events" ADD CONSTRAINT "security_events_subjectWebhookEventId_fkey" FOREIGN KEY ("subjectWebhookEventId") REFERENCES "provider_verification_webhook_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('case_events_caseId_fkey', 'ALTER TABLE "case_events" ADD CONSTRAINT "case_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('case_notes_caseId_fkey', 'ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('admin_users_invitedById_fkey', 'ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('admin_audit_events_adminId_fkey', 'ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('category_required_certifications_categoryId_fkey', 'ALTER TABLE "category_required_certifications" ADD CONSTRAINT "category_required_certifications_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('category_required_equipment_categoryId_fkey', 'ALTER TABLE "category_required_equipment" ADD CONSTRAINT "category_required_equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('category_required_vehicle_types_categoryId_fkey', 'ALTER TABLE "category_required_vehicle_types" ADD CONSTRAINT "category_required_vehicle_types_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('customer_merge_events_sourceCustomerId_fkey', 'ALTER TABLE "customer_merge_events" ADD CONSTRAINT "customer_merge_events_sourceCustomerId_fkey" FOREIGN KEY ("sourceCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('customer_merge_events_targetCustomerId_fkey', 'ALTER TABLE "customer_merge_events" ADD CONSTRAINT "customer_merge_events_targetCustomerId_fkey" FOREIGN KEY ("targetCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('customer_notes_customerId_fkey', 'ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_notes_providerId_fkey', 'ALTER TABLE "provider_notes" ADD CONSTRAINT "provider_notes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_certifications_providerId_fkey', 'ALTER TABLE "provider_certifications" ADD CONSTRAINT "provider_certifications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_equipment_providerId_fkey', 'ALTER TABLE "provider_equipment" ADD CONSTRAINT "provider_equipment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_live_status_providerId_fkey', 'ALTER TABLE "provider_live_status" ADD CONSTRAINT "provider_live_status_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('candidate_pool_providerId_fkey', 'ALTER TABLE "candidate_pool" ADD CONSTRAINT "candidate_pool_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('candidate_pool_locationNodeId_fkey', 'ALTER TABLE "candidate_pool" ADD CONSTRAINT "candidate_pool_locationNodeId_fkey" FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT _plugapro_add_constraint_if_missing('provider_capacity_providerId_fkey', 'ALTER TABLE "provider_capacity" ADD CONSTRAINT "provider_capacity_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE');

DROP FUNCTION _plugapro_add_constraint_if_missing(text, text);

-- The historical RLS migration already ran on production before these drifted
-- tables were restored. Re-enable RLS idempotently for every Prisma public table.
ALTER TABLE IF EXISTS "public"."account_security_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."admin_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."admin_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."application_error_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."assignment_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."booking_status_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."candidate_pool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."case_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."case_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."category_required_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."category_required_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."category_required_vehicle_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."customer_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."customer_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."customer_merge_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."customer_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."dispatch_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."disputes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."extra_work" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."inbound_whatsapp_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."inspection_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."job_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."job_status_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."lead_unlock_disputes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."lead_unlocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."location_nodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."match_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."message_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."onboarding_intakes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."ops_queue_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."otp_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."otp_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."payment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."promo_vouchers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_auto_approve_side_effect_markers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_campaign_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_capacity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_identity_consent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_identity_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_identity_verification_pilot_allowlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_identity_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_lead_access_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_lead_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_live_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_promo_awards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_sensitive_data_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_shortlist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_shortlists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_verification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_verification_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_verification_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."reason_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."service_area_waitlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."technician_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."technician_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."technician_schedule_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."technician_service_areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."technician_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."verification_vendor_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."voucher_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."voucher_redemption_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."wallet_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."whatsapp_preference_logs" ENABLE ROW LEVEL SECURITY;
