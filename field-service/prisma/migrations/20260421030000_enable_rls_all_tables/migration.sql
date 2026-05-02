-- ─── S-1: Enable Row Level Security on all public tables ──────────────────────
-- All application DB access uses the Prisma service role key, which bypasses
-- RLS entirely. Enabling RLS with no policies defaults to DENY ALL for the
-- anon and authenticated roles, closing the PostgREST attack surface without
-- any application code changes.
--
-- Reference: https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public

-- ─── PII / Financial ──────────────────────────────────────────────────────────
ALTER TABLE "public"."customers"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."providers"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."addresses"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payments"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."invoices"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_payouts"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."quotes"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."bookings"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobs"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."job_requests"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."matches"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."leads"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reviews"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."disputes"               ENABLE ROW LEVEL SECURITY;

-- ─── Internal ops ─────────────────────────────────────────────────────────────
ALTER TABLE "public"."cases"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."case_events"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."case_notes"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ops_queue_assignments"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_users"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_audit_events"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."dispatch_decisions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."match_attempts"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."assignment_holds"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feature_flags"          ENABLE ROW LEVEL SECURITY;

-- ─── Provider data ────────────────────────────────────────────────────────────
ALTER TABLE "public"."provider_applications"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_notes"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_certifications"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_equipment"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_schedule"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_skills"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_certifications"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_service_areas"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_availability"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_schedule_items"  ENABLE ROW LEVEL SECURITY;

-- ─── Messaging / consent ──────────────────────────────────────────────────────
ALTER TABLE "public"."conversations"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inbound_whatsapp_messages"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."message_events"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."whatsapp_preference_logs"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."push_subscriptions"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attachments"                ENABLE ROW LEVEL SECURITY;

-- ─── Customer support ─────────────────────────────────────────────────────────
ALTER TABLE "public"."customer_notes"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."customer_merge_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."extra_work"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."job_status_events"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inspection_slots"      ENABLE ROW LEVEL SECURITY;

-- ─── Reference / lookup ───────────────────────────────────────────────────────
ALTER TABLE "public"."location_nodes"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."categories"                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."category_required_certifications"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."category_required_equipment"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."category_required_vehicle_types"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reason_codes"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."service_area_waitlist"             ENABLE ROW LEVEL SECURITY;

-- ─── Marketing ────────────────────────────────────────────────────────────────
ALTER TABLE "public"."marketing_leads"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."onboarding_intakes"  ENABLE ROW LEVEL SECURITY;

-- ─── Internal ─────────────────────────────────────────────────────────────────
-- _prisma_migrations: Prisma connects as service role (bypasses RLS) so this
-- does not affect migrations. Protects migration history from anon reads.
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
