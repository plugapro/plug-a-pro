-- Add Pay@ RTP lookup key to payment_intents
-- clientAccountNumber: the 14-digit numeric key sent to Pay@ rtp/create and
-- required to read the RTP back via rtp/read. Nullable because intents
-- created before this migration never captured it.

ALTER TABLE "payment_intents" ADD COLUMN "clientAccountNumber" TEXT;

CREATE INDEX "payment_intents_clientAccountNumber_idx" ON "payment_intents"("clientAccountNumber");
