-- Speeds up Pay@Go callback/status lookups by provider checkout/account reference.
CREATE INDEX IF NOT EXISTS "payments_pspProvider_pspCheckoutId_idx"
ON "payments"("pspProvider", "pspCheckoutId");
