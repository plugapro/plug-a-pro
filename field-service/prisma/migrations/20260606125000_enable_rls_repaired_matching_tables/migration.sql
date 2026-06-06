-- Static RLS coverage guard requires schema-qualified ALTER TABLE statements.
-- The previous drift-repair migration already enabled RLS at runtime; these
-- statements are idempotent and keep the migration audit trail explicit.

ALTER TABLE "public"."provider_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_service_areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technician_schedule_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."dispatch_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."match_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."assignment_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_live_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."candidate_pool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_capacity" ENABLE ROW LEVEL SECURITY;
