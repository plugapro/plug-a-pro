-- Security fix (00366bbf): Defensively re-assert Row Level Security on the
-- auth- and PII-critical tables.
--
-- The prior drift-repair migration (20260606170000_force_reapply_runtime_schema)
-- was a non-atomic ~2900-line script that only enabled RLS at the very end. An
-- abort partway through could have left some auth tables (especially admin_users)
-- without RLS. The live DB is currently fine, but this follow-up closes the
-- exposure window defensively.
--
-- ENABLE ROW LEVEL SECURITY is idempotent (re-enabling an already-enabled table is
-- a no-op), and `IF EXISTS` makes each statement safe even if a table is absent in
-- a given environment. This migration adds no policies and changes no schema — it
-- only guarantees the RLS flag is set on every security-critical table.

ALTER TABLE IF EXISTS "public"."admin_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."admin_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."account_security_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_identity_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_identity_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_sensitive_data_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_campaign_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."provider_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."wallet_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."otp_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."whatsapp_preference_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."payment_intents" ENABLE ROW LEVEL SECURITY;
