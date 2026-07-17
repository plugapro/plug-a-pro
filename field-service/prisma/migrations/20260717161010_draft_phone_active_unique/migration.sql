-- Deploying before dedupe WILL FAIL: CREATE UNIQUE INDEX aborts with a unique-violation
-- on the first duplicate un-submitted phone pair still present in the table.
-- Partial unique index: at most one un-submitted registration draft per phone.
-- Deploy ONLY after scripts/dedupe-registration-drafts.ts --execute has run in
-- prod and reported zero remaining conflicts (spec §Rollout step 3).
CREATE UNIQUE INDEX "provider_application_drafts_phone_active_key"
ON "public"."provider_application_drafts" ("phone")
WHERE "submittedApplicationId" IS NULL;
