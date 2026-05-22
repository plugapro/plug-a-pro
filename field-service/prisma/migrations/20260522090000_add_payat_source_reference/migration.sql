-- Add Pay@ merchant RTP fields to payment_intents
-- sourceReference: the retail till reference shown to the provider (e.g. "12345678901234")
-- requestToPayId: Pay@ internal integer RTP identifier (for rtp:read / rtp:cancel)

ALTER TABLE "payment_intents" ADD COLUMN "sourceReference" TEXT;
ALTER TABLE "payment_intents" ADD COLUMN "requestToPayId" INTEGER;

CREATE INDEX "payment_intents_sourceReference_idx" ON "payment_intents"("sourceReference");
