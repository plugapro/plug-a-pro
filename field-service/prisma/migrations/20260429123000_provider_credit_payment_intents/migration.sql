-- Provider credit top-up payment intents.
-- Manual EFT is the first supported method. Credits are only issued after
-- reconciliation confirms funds; creating an intent does not mutate wallets.

CREATE TYPE "PaymentIntentMethod" AS ENUM (
  'MANUAL_EFT',
  'PAYMENT_LINK',
  'GATEWAY_CARD',
  'GATEWAY_EFT'
);

CREATE TYPE "PaymentIntentStatus" AS ENUM (
  'CREATED',
  'PENDING_PAYMENT',
  'PROOF_UPLOADED',
  'MATCHED_ON_STATEMENT',
  'CREDITED',
  'FAILED',
  'EXPIRED',
  'REVERSED'
);

CREATE TABLE "payment_intents" (
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
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "creditedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_amountCents_minimum"
  CHECK ("amountCents" >= 10000);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_amountCents_credit_multiple"
  CHECK (MOD("amountCents", 2000) = 0);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_creditsToIssue_positive"
  CHECK ("creditsToIssue" > 0);

CREATE UNIQUE INDEX "payment_intents_paymentReference_key" ON "payment_intents"("paymentReference");
CREATE INDEX "payment_intents_providerId_createdAt_idx" ON "payment_intents"("providerId", "createdAt");
CREATE INDEX "payment_intents_status_createdAt_idx" ON "payment_intents"("status", "createdAt");
CREATE INDEX "payment_intents_bankStatementReference_idx" ON "payment_intents"("bankStatementReference");

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
