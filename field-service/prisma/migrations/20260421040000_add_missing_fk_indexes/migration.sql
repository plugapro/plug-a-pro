-- ─── P-1: Add missing foreign key indexes ─────────────────────────────────────
-- Applied directly via Supabase MCP apply_migration (not prisma migrate deploy)
-- because CONCURRENTLY cannot run in a transaction; omitted here since tables
-- are small at current scale. Re-add CONCURRENTLY if applying to a scaled DB.
--
-- Reference: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

CREATE INDEX IF NOT EXISTS "idx_addresses_customerId"                          ON "public"."addresses"                  ("customerId");
CREATE INDEX IF NOT EXISTS "idx_admin_users_invitedById"                       ON "public"."admin_users"                ("invitedById");
CREATE INDEX IF NOT EXISTS "idx_assignment_holds_providerId"                   ON "public"."assignment_holds"           ("providerId");
CREATE INDEX IF NOT EXISTS "idx_assignment_holds_dispatchDecisionId"           ON "public"."assignment_holds"           ("dispatchDecisionId");
CREATE INDEX IF NOT EXISTS "idx_assignment_holds_matchAttemptId"               ON "public"."assignment_holds"           ("matchAttemptId");
CREATE INDEX IF NOT EXISTS "idx_attachments_jobId"                             ON "public"."attachments"                ("jobId");
CREATE INDEX IF NOT EXISTS "idx_attachments_jobRequestId"                      ON "public"."attachments"                ("jobRequestId");
CREATE INDEX IF NOT EXISTS "idx_attachments_inspectionSlotId"                  ON "public"."attachments"                ("inspectionSlotId");
CREATE INDEX IF NOT EXISTS "idx_attachments_providerApplicationId"             ON "public"."attachments"                ("providerApplicationId");
CREATE INDEX IF NOT EXISTS "idx_customers_mergedIntoCustomerId"                ON "public"."customers"                  ("mergedIntoCustomerId");
CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_selectedProviderId"         ON "public"."dispatch_decisions"         ("selectedProviderId");
CREATE INDEX IF NOT EXISTS "idx_extra_work_jobId"                              ON "public"."extra_work"                 ("jobId");
CREATE INDEX IF NOT EXISTS "idx_inspection_slots_matchId"                      ON "public"."inspection_slots"           ("matchId");
CREATE INDEX IF NOT EXISTS "idx_job_requests_customerId"                       ON "public"."job_requests"               ("customerId");
CREATE INDEX IF NOT EXISTS "idx_job_requests_addressId"                        ON "public"."job_requests"               ("addressId");
CREATE INDEX IF NOT EXISTS "idx_job_requests_preferredProviderId"              ON "public"."job_requests"               ("preferredProviderId");
CREATE INDEX IF NOT EXISTS "idx_job_status_events_jobId"                       ON "public"."job_status_events"          ("jobId");
CREATE INDEX IF NOT EXISTS "idx_jobs_providerId"                               ON "public"."jobs"                       ("providerId");
CREATE INDEX IF NOT EXISTS "idx_leads_providerId"                              ON "public"."leads"                      ("providerId");
CREATE INDEX IF NOT EXISTS "idx_leads_dispatchDecisionId"                      ON "public"."leads"                      ("dispatchDecisionId");
CREATE INDEX IF NOT EXISTS "idx_leads_matchAttemptId"                          ON "public"."leads"                      ("matchAttemptId");
CREATE INDEX IF NOT EXISTS "idx_leads_assignmentHoldId"                        ON "public"."leads"                      ("assignmentHoldId");
CREATE INDEX IF NOT EXISTS "idx_location_nodes_parentId"                       ON "public"."location_nodes"             ("parentId");
CREATE INDEX IF NOT EXISTS "idx_match_attempts_providerId"                     ON "public"."match_attempts"             ("providerId");
CREATE INDEX IF NOT EXISTS "idx_matches_providerId"                            ON "public"."matches"                    ("providerId");
CREATE INDEX IF NOT EXISTS "idx_message_events_customerId"                     ON "public"."message_events"             ("customerId");
CREATE INDEX IF NOT EXISTS "idx_message_events_bookingId"                      ON "public"."message_events"             ("bookingId");
CREATE INDEX IF NOT EXISTS "idx_provider_applications_providerId"              ON "public"."provider_applications"      ("providerId");
CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_providerId"                 ON "public"."push_subscriptions"         ("providerId");
CREATE INDEX IF NOT EXISTS "idx_quotes_matchId"                                ON "public"."quotes"                     ("matchId");
CREATE INDEX IF NOT EXISTS "idx_reviews_customerId"                            ON "public"."reviews"                    ("customerId");
CREATE INDEX IF NOT EXISTS "idx_reviews_providerId"                            ON "public"."reviews"                    ("providerId");
CREATE INDEX IF NOT EXISTS "idx_technician_schedule_items_bookingId"           ON "public"."technician_schedule_items"  ("bookingId");
CREATE INDEX IF NOT EXISTS "idx_technician_schedule_items_jobRequestId"        ON "public"."technician_schedule_items"  ("jobRequestId");
CREATE INDEX IF NOT EXISTS "idx_technician_schedule_items_assignmentHoldId"    ON "public"."technician_schedule_items"  ("assignmentHoldId");
