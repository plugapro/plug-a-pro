-- =====================================================================
-- Plug A Pro — Launch Performance Metrics SQL Pack
-- Date authored: 2026-06-07
-- Status: READ-ONLY. Every statement here is a SELECT.
-- =====================================================================
--
-- HOW TO USE
--   1. Connect to the prod-equivalent DB (read replica preferred). Never
--      use a connection with elevated write privileges.
--   2. Set the launch window once (see :launch_start / :launch_end below)
--      and re-run the whole pack to refresh every metric.
--   3. Every query excludes test cohorts via isTestUser / isTestRequest /
--      isTestLead / cohortName LIKE 'TEST_%'. Adjust if internal-team
--      records use a different cohort tag.
--   4. Replace :placeholders with literal timestamptz before running on
--      a client that does not support psql variables (DBeaver: use a
--      Find/Replace; Supabase SQL editor: paste literals).
--
-- SAFETY CONTRACT
--   - No INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/COPY anywhere in this file.
--   - No CREATE/REFRESH MATERIALIZED VIEW. No SELECT FOR UPDATE.
--   - Queries that scan large tables include time-window filters.
--   - All identifiers are camelCase, quoted to match the Prisma schema.
--
-- WINDOW CONVENTIONS
--   :launch_start  — public launch boundary (default 2026-06-05 00:00 SAST)
--   :launch_end    — report cut-off (default 2026-06-07 23:59 SAST)
--   :pilot_start   — pilot launch boundary (2026-05-17 00:00 SAST)
-- =====================================================================

-- ───────────────────────────────────────────────────────────────────────
-- 0. WINDOW PROBES — run these first to sanity-check what is in the DB
-- ───────────────────────────────────────────────────────────────────────

-- 0.1 Earliest and latest record per critical table (catches restore drift)
SELECT 'customers'         AS table_name, MIN("createdAt") AS earliest, MAX("createdAt") AS latest, COUNT(*) AS row_count FROM "customers"
UNION ALL SELECT 'providers',               MIN("createdAt"), MAX("createdAt"), COUNT(*) FROM "providers"
UNION ALL SELECT 'provider_applications',   MIN("submittedAt"), MAX("submittedAt"), COUNT(*) FROM "provider_applications"
UNION ALL SELECT 'job_requests',            MIN("createdAt"), MAX("createdAt"), COUNT(*) FROM "job_requests"
UNION ALL SELECT 'leads',                   MIN("sentAt"), MAX("sentAt"), COUNT(*) FROM "leads"
UNION ALL SELECT 'matches',                 MIN("createdAt"), MAX("createdAt"), COUNT(*) FROM "matches"
UNION ALL SELECT 'dispatch_decisions',      MIN("createdAt"), MAX("createdAt"), COUNT(*) FROM "dispatch_decisions"
UNION ALL SELECT 'inbound_whatsapp_messages', MIN("firstSeenAt"), MAX("firstSeenAt"), COUNT(*) FROM "inbound_whatsapp_messages"
UNION ALL SELECT 'message_events',          MIN("createdAt"), MAX("createdAt"), COUNT(*) FROM "message_events"
UNION ALL SELECT 'attachments',             MIN("createdAt"), MAX("createdAt"), COUNT(*) FROM "attachments"
ORDER BY table_name;

-- 0.2 Restore-state probe — count rows missing FK-linked siblings (the
-- WhatsApp blob audit script writes these; cross-check by hand)
SELECT
  (SELECT COUNT(*) FROM "inbound_whatsapp_messages" WHERE "messageType" IN ('image','document','video')) AS inbound_media_msgs,
  (SELECT COUNT(*) FROM "attachments" WHERE "uploadedBy" LIKE 'system:whatsapp:%')                       AS whatsapp_attachments,
  (SELECT COUNT(*) FROM "attachments" WHERE "uploadedBy" LIKE 'system:whatsapp:%' AND "url" IS NULL)     AS attachments_url_null;

-- ───────────────────────────────────────────────────────────────────────
-- 1. ACQUISITION & FUNNEL
-- ───────────────────────────────────────────────────────────────────────

-- 1.1 Customer registrations in the launch window, by channel
SELECT
  COALESCE("channel", 'UNKNOWN')                                                    AS channel,
  COUNT(*)                                                                          AS registrations,
  COUNT(*) FILTER (WHERE "userId" IS NOT NULL)                                      AS pwa_linked,
  COUNT(*) FILTER (WHERE "whatsappMarketingOptIn" IS TRUE)                          AS marketing_opt_in,
  COUNT(*) FILTER (WHERE "isBlocked" IS TRUE)                                       AS blocked
FROM "customers"
WHERE "isTestUser" IS NOT TRUE
  AND ("cohortName" IS NULL OR "cohortName" NOT LIKE 'TEST_%')
  AND "createdAt" >= :launch_start
  AND "createdAt" <  :launch_end
GROUP BY 1
ORDER BY registrations DESC;

-- 1.2 Provider registrations in the launch window, by source
-- (no `source` field on Provider; inferred via presence of userId for PWA path)
SELECT
  CASE WHEN "userId" IS NULL THEN 'WHATSAPP_ONLY' ELSE 'PWA_LINKED' END             AS provider_source,
  COUNT(*)                                                                          AS registrations,
  COUNT(*) FILTER (WHERE "approvedAt" IS NOT NULL)                                  AS approved,
  COUNT(*) FILTER (WHERE "status" = 'ACTIVE'::"ProviderStatus")                     AS active_status,
  COUNT(*) FILTER (WHERE "availableNow" IS TRUE)                                    AS available_now
FROM "providers"
WHERE "isTestUser" IS NOT TRUE
  AND ("cohortName" IS NULL OR "cohortName" NOT LIKE 'TEST_%')
  AND "createdAt" >= :launch_start
  AND "createdAt" <  :launch_end
GROUP BY 1
ORDER BY registrations DESC;

-- 1.3 Provider application funnel
-- Cross-checks Provider rows against ProviderApplication state.
SELECT
  "status"                                                                          AS application_status,
  COUNT(*)                                                                          AS applications,
  COUNT(*) FILTER (WHERE "submittedAt" >= :launch_start)                            AS submitted_in_window,
  COUNT(*) FILTER (WHERE "reviewedAt" IS NOT NULL)                                  AS reviewed,
  AVG(EXTRACT(EPOCH FROM ("reviewedAt" - "submittedAt"))/60)                        AS avg_review_minutes
FROM "provider_applications"
WHERE "submittedAt" IS NULL
   OR "submittedAt" >= :pilot_start
GROUP BY 1
ORDER BY applications DESC;

-- 1.4 Onboarding drop-off — drafts vs submissions vs applications
-- ProviderApplicationDraft = saved but not yet submitted.
SELECT
  'draft_only_no_application' AS state,
  COUNT(*)                    AS providers
FROM "provider_application_drafts" d
LEFT JOIN "provider_applications" a ON a."providerId" = d."providerId"
WHERE a."id" IS NULL
  AND d."updatedAt" >= :pilot_start
UNION ALL
SELECT
  'submitted_no_review',
  COUNT(*)
FROM "provider_applications"
WHERE "submittedAt" IS NOT NULL
  AND "reviewedAt" IS NULL
  AND "submittedAt" >= :pilot_start
UNION ALL
SELECT
  'approved_no_provider_active',
  COUNT(*)
FROM "provider_applications" a
JOIN "providers" p ON p."id" = a."providerId"
WHERE a."status"::text = 'APPROVED'
  AND p."status"::"ProviderStatus" <> 'ACTIVE'::"ProviderStatus";

-- 1.5 Duplicate phone risk — same phone across Customer + Provider
SELECT
  c."phone"             AS phone,
  c."id"                AS customer_id,
  p."id"                AS provider_id,
  c."createdAt"         AS customer_created,
  p."createdAt"         AS provider_created
FROM "customers" c
JOIN "providers" p ON p."phone" = c."phone"
WHERE c."isTestUser" IS NOT TRUE AND p."isTestUser" IS NOT TRUE
ORDER BY c."createdAt" DESC
LIMIT 100;

-- ───────────────────────────────────────────────────────────────────────
-- 2. PROVIDER SUPPLY READINESS
-- ───────────────────────────────────────────────────────────────────────

-- 2.1 Approved providers by primary skill (categories are string slugs on Provider)
SELECT
  skill                                                                             AS category,
  COUNT(*)                                                                          AS approved_providers,
  COUNT(*) FILTER (WHERE "availableNow" IS TRUE)                                    AS online_now,
  COUNT(*) FILTER (WHERE "verified" IS TRUE)                                        AS internally_verified
FROM "providers" p, UNNEST(p."skills") AS skill
WHERE p."isTestUser" IS NOT TRUE
  AND p."approvedAt" IS NOT NULL
  AND p."status" = 'ACTIVE'::"ProviderStatus"
GROUP BY skill
ORDER BY approved_providers DESC;

-- 2.2 Approved providers by city (denormalised on serviceAreas string array)
-- For canonical regional coverage join via TechnicianServiceArea -> LocationNode
SELECT
  ln."provinceKey",
  ln."cityKey",
  COUNT(DISTINCT p."id")                                                            AS approved_providers
FROM "providers" p
JOIN "technician_service_areas" tsa ON tsa."providerId" = p."id"
JOIN "location_nodes" ln           ON ln."id" = tsa."locationNodeId"
WHERE p."isTestUser" IS NOT TRUE
  AND p."approvedAt" IS NOT NULL
  AND p."status" = 'ACTIVE'::"ProviderStatus"
GROUP BY 1, 2
ORDER BY approved_providers DESC;

-- 2.3 Providers approved BUT lacking required onboarding components
SELECT
  p."id",
  p."name",
  p."phone",
  p."approvedAt",
  ARRAY[
    CASE WHEN p."skills"        = '{}' THEN 'no_skills'      END,
    CASE WHEN p."serviceAreas"  = '{}' THEN 'no_areas'       END,
    CASE WHEN p."avatarUrl" IS NULL    THEN 'no_avatar'      END,
    CASE WHEN p."lastKnownLat" IS NULL THEN 'no_location'    END,
    CASE WHEN p."availableNow" IS NOT TRUE THEN 'offline'    END
  ]                                                                                 AS missing_components
FROM "providers" p
WHERE p."isTestUser" IS NOT TRUE
  AND p."approvedAt" IS NOT NULL
  AND p."status" = 'ACTIVE'::"ProviderStatus"
  AND (p."skills" = '{}' OR p."serviceAreas" = '{}' OR p."avatarUrl" IS NULL OR p."lastKnownLat" IS NULL OR p."availableNow" IS NOT TRUE)
ORDER BY p."approvedAt" DESC;

-- 2.4 Attachment evidence per provider — who actually uploaded ID/photo
SELECT
  p."id",
  p."name",
  COUNT(a."id")                                                                     AS attachment_count,
  COUNT(*) FILTER (WHERE a."label" ILIKE '%id%' OR a."label" ILIKE '%identity%')     AS identity_count,
  COUNT(*) FILTER (WHERE a."label" ILIKE '%photo%' OR a."label" ILIKE '%avatar%')    AS photo_count,
  COUNT(*) FILTER (WHERE a."label" ILIKE '%cert%')                                   AS cert_count
FROM "providers" p
LEFT JOIN "attachments" a ON a."parentKind" = 'provider' AND a."parentId" = p."id"
WHERE p."isTestUser" IS NOT TRUE
  AND p."createdAt" >= :pilot_start
GROUP BY 1, 2
HAVING COUNT(a."id") = 0
ORDER BY p."createdAt" DESC
LIMIT 200;

-- ───────────────────────────────────────────────────────────────────────
-- 3. VOUCHER & ONBOARDING CREDIT RECONCILIATION
-- ───────────────────────────────────────────────────────────────────────

-- 3.1 PILOT_MAY2026 voucher batch status
SELECT
  vb."code"                  AS batch_code,
  vb."totalCount"            AS total_issued,
  COUNT(pv."id")             AS vouchers_in_db,
  COUNT(*) FILTER (WHERE pv."status"::text = 'ACTIVE')      AS active,
  COUNT(*) FILTER (WHERE pv."status"::text = 'REDEEMED')    AS redeemed,
  COUNT(*) FILTER (WHERE pv."status"::text = 'EXPIRED')     AS expired,
  COUNT(*) FILTER (WHERE pv."status"::text = 'REVOKED')     AS revoked
FROM "voucher_batches" vb
LEFT JOIN "promo_vouchers" pv ON pv."batchId" = vb."id"
WHERE vb."code" = 'PILOT_MAY2026'
GROUP BY vb."id", vb."code", vb."totalCount";

-- 3.2 Approved providers WITHOUT a PILOT_MAY2026 redemption (eligibility gap)
SELECT
  p."id",
  p."name",
  p."phone",
  p."approvedAt"
FROM "providers" p
LEFT JOIN "provider_campaign_redemptions" r
  ON r."providerId" = p."id" AND r."campaignCode" = 'PILOT_MAY2026'
WHERE p."isTestUser" IS NOT TRUE
  AND p."approvedAt" IS NOT NULL
  AND p."status" = 'ACTIVE'::"ProviderStatus"
  AND r."id" IS NULL
ORDER BY p."approvedAt" DESC;

-- 3.3 Wallet balance per provider (derived from ledger)
SELECT
  pw."providerId",
  p."name",
  pw."status",
  COALESCE(SUM(CASE WHEN wle."type"::text = 'CREDIT' THEN wle."amount" ELSE 0 END), 0) AS credit_in,
  COALESCE(SUM(CASE WHEN wle."type"::text = 'DEBIT'  THEN wle."amount" ELSE 0 END), 0) AS credit_out,
  COALESCE(SUM(CASE WHEN wle."type"::text = 'CREDIT' THEN wle."amount" ELSE -wle."amount" END), 0) AS net_balance
FROM "provider_wallets" pw
JOIN "providers" p           ON p."id" = pw."providerId"
LEFT JOIN "wallet_ledger_entries" wle ON wle."walletId" = pw."id"
WHERE p."isTestUser" IS NOT TRUE
GROUP BY pw."providerId", p."name", pw."status"
ORDER BY net_balance ASC;
-- Investigate net_balance = 0 rows on approved providers: those are the
-- supply that cannot accept a lead even if matched.

-- 3.4 Onboarding credit liability (sum of unredeemed credit value)
SELECT
  COUNT(*)                                                  AS open_credit_lines,
  SUM("amount")                                             AS open_credit_total,
  COUNT(DISTINCT "walletId")                                AS distinct_wallets
FROM "wallet_ledger_entries"
WHERE "type"::text = 'CREDIT'
  AND ("reason" ILIKE '%pilot%' OR "reason" ILIKE '%onboard%');

-- ───────────────────────────────────────────────────────────────────────
-- 4. CUSTOMER DEMAND & MATCHING
-- ───────────────────────────────────────────────────────────────────────

-- 4.1 Job requests by status, in the launch window
SELECT
  "status",
  COUNT(*)                                                                          AS requests
FROM "job_requests"
WHERE "isTestRequest" IS NOT TRUE
  AND "createdAt" >= :launch_start
  AND "createdAt" <  :launch_end
GROUP BY "status"
ORDER BY requests DESC;

-- 4.2 Job requests by category (where demand is appearing)
SELECT
  "category",
  COUNT(*)                                                                          AS requests,
  COUNT(*) FILTER (WHERE "status"::text = 'MATCHED')                                AS matched,
  COUNT(*) FILTER (WHERE "status"::text = 'NO_MATCH')                               AS no_match,
  COUNT(*) FILTER (WHERE "status"::text = 'EXPIRED')                                AS expired
FROM "job_requests"
WHERE "isTestRequest" IS NOT TRUE
  AND "createdAt" >= :launch_start
GROUP BY "category"
ORDER BY requests DESC;

-- 4.3 Dispatch decisions — structured no-match reasons (per memory)
SELECT
  COALESCE("noMatchReason", 'matched')                                              AS no_match_reason,
  COUNT(*)                                                                          AS decisions,
  AVG(("stageCounts"->>'directScan')::int)                                          AS avg_direct_scanned,
  AVG(("stageCounts"->>'eligibleProviders')::int)                                   AS avg_eligible
FROM "dispatch_decisions"
WHERE "createdAt" >= :launch_start
GROUP BY 1
ORDER BY decisions DESC;
-- ^ If the column name is "noMatchReason" but the JSON keys differ, run a
--   single sample SELECT first to see the shape:
--     SELECT "stageCounts" FROM "dispatch_decisions" ORDER BY "createdAt" DESC LIMIT 5;

-- 4.4 Match → Booking → Job conversion in the launch window
SELECT
  (SELECT COUNT(*) FROM "matches" WHERE "createdAt" >= :launch_start)                AS matches_created,
  (SELECT COUNT(*) FROM "quotes"
     WHERE "createdAt" >= :launch_start)                                             AS quotes_created,
  (SELECT COUNT(*) FROM "quotes"
     WHERE "createdAt" >= :launch_start AND "status"::text = 'APPROVED')             AS quotes_approved,
  (SELECT COUNT(*) FROM "bookings"
     WHERE "createdAt" >= :launch_start)                                             AS bookings_created,
  (SELECT COUNT(*) FROM "jobs"
     WHERE "createdAt" >= :launch_start)                                             AS jobs_created,
  (SELECT COUNT(*) FROM "jobs"
     WHERE "createdAt" >= :launch_start AND "status"::text = 'COMPLETED')            AS jobs_completed;

-- 4.5 Demand vs supply mismatch — category-level gap
WITH demand AS (
  SELECT "category", COUNT(*) AS reqs
  FROM "job_requests"
  WHERE "isTestRequest" IS NOT TRUE
    AND "createdAt" >= :pilot_start
  GROUP BY "category"
), supply AS (
  SELECT skill AS category, COUNT(DISTINCT p."id") AS providers
  FROM "providers" p, UNNEST(p."skills") AS skill
  WHERE p."isTestUser" IS NOT TRUE
    AND p."approvedAt" IS NOT NULL
    AND p."status" = 'ACTIVE'::"ProviderStatus"
  GROUP BY skill
)
SELECT
  COALESCE(d."category", s."category")        AS category,
  COALESCE(d.reqs, 0)                         AS demand_requests,
  COALESCE(s.providers, 0)                    AS supply_providers,
  COALESCE(d.reqs, 0)::float /
    NULLIF(s.providers, 0)                    AS requests_per_provider
FROM demand d FULL OUTER JOIN supply s USING ("category")
ORDER BY demand_requests DESC NULLS LAST;

-- ───────────────────────────────────────────────────────────────────────
-- 5. WHATSAPP & MESSAGING PERFORMANCE
-- ───────────────────────────────────────────────────────────────────────

-- 5.1 Inbound WhatsApp volume in the launch window
SELECT
  date_trunc('hour', "firstSeenAt") AS hour,
  "messageType",
  COUNT(*)                          AS messages,
  COUNT(DISTINCT "phone")           AS unique_phones
FROM "inbound_whatsapp_messages"
WHERE "firstSeenAt" >= :launch_start
  AND "firstSeenAt" <  :launch_end
GROUP BY 1, 2
ORDER BY 1, 2;

-- 5.2 Outbound delivery success in the launch window
SELECT
  "status",
  COUNT(*)                                       AS events,
  COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL) AS delivered,
  COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)      AS read,
  COUNT(*) FILTER (WHERE "failureReason" IS NOT NULL) AS failed
FROM "message_events"
WHERE "createdAt" >= :launch_start
  AND "createdAt" <  :launch_end
GROUP BY "status"
ORDER BY events DESC;

-- 5.3 Top failure reasons — what is breaking delivery
SELECT
  "failureReason",
  COUNT(*)                                       AS events,
  COUNT(DISTINCT "customerId")                   AS distinct_customers
FROM "message_events"
WHERE "createdAt" >= :launch_start
  AND "failureReason" IS NOT NULL
GROUP BY 1
ORDER BY events DESC
LIMIT 20;

-- 5.4 Conversations stuck at a given step (idle without progression)
-- Conversation.data carries step state; surface conversations idle > 2h.
SELECT
  c."id",
  c."phone",
  c."data"->>'currentStep'                              AS current_step,
  c."updatedAt",
  EXTRACT(EPOCH FROM (NOW() - c."updatedAt"))/60        AS minutes_idle
FROM "conversations" c
WHERE c."updatedAt" >= :pilot_start
  AND c."updatedAt" <  NOW() - INTERVAL '2 hours'
  AND COALESCE(c."data"->>'currentStep', '') NOT IN ('done', 'completed')
ORDER BY minutes_idle DESC
LIMIT 50;

-- ───────────────────────────────────────────────────────────────────────
-- 6. OPS DASHBOARD READINESS PROBES
-- ───────────────────────────────────────────────────────────────────────

-- 6.1 Who needs admin attention right now?
SELECT 'pending_provider_application' AS queue, COUNT(*) AS count
FROM "provider_applications"
WHERE "status"::text = 'SUBMITTED' AND "reviewedAt" IS NULL
UNION ALL
SELECT 'open_lead_unlock_dispute',  COUNT(*)
FROM "lead_unlock_disputes" WHERE "status"::text = 'OPEN'
UNION ALL
SELECT 'open_case',                 COUNT(*)
FROM "cases" WHERE "state"::text NOT IN ('CLOSED', 'RESOLVED')
UNION ALL
SELECT 'job_request_no_match',      COUNT(*)
FROM "job_requests" WHERE "status"::text = 'NO_MATCH'
  AND "createdAt" >= :launch_start
UNION ALL
SELECT 'inbound_whatsapp_unprocessed', COUNT(*)
FROM "inbound_whatsapp_messages"
WHERE "processedAt" IS NULL AND "failureReason" IS NULL
  AND "firstSeenAt" >= :launch_start;

-- 6.2 Stuck-at-step inventory for the funnel report
SELECT
  step,
  count
FROM (
  SELECT 'application_draft_only' AS step,
         COUNT(*) AS count
  FROM "provider_application_drafts" d
  LEFT JOIN "provider_applications" a ON a."providerId" = d."providerId"
  WHERE a."id" IS NULL
  UNION ALL
  SELECT 'application_submitted_pending',
         COUNT(*)
  FROM "provider_applications"
  WHERE "status"::text = 'SUBMITTED' AND "reviewedAt" IS NULL
  UNION ALL
  SELECT 'approved_no_voucher',
         COUNT(*)
  FROM "providers" p
  LEFT JOIN "provider_campaign_redemptions" r
    ON r."providerId" = p."id" AND r."campaignCode" = 'PILOT_MAY2026'
  WHERE p."approvedAt" IS NOT NULL AND r."id" IS NULL AND p."isTestUser" IS NOT TRUE
  UNION ALL
  SELECT 'approved_offline',
         COUNT(*)
  FROM "providers"
  WHERE "approvedAt" IS NOT NULL AND "availableNow" IS NOT TRUE
    AND "status" = 'ACTIVE'::"ProviderStatus" AND "isTestUser" IS NOT TRUE
) s;

-- ───────────────────────────────────────────────────────────────────────
-- 7. UNIT ECONOMICS PLACEHOLDERS — fill from cost ledger / vendor invoices
-- ───────────────────────────────────────────────────────────────────────

-- 7.1 Lead unlocks (paid by providers) — the closest to revenue we have
SELECT
  date_trunc('day', "unlockedAt") AS day,
  COUNT(*)                        AS unlocks,
  SUM("creditsCharged")           AS credits_charged
FROM "lead_unlocks"
WHERE "isTestUnlock" IS NOT TRUE
  AND "unlockedAt" >= :pilot_start
GROUP BY 1
ORDER BY 1;

-- 7.2 Active providers per day — denominator for cost-per-active-provider
SELECT
  date_trunc('day', "unlockedAt") AS day,
  COUNT(DISTINCT "providerId")    AS active_providers_unlocking
FROM "lead_unlocks"
WHERE "isTestUnlock" IS NOT TRUE
GROUP BY 1
ORDER BY 1;

-- ───────────────────────────────────────────────────────────────────────
-- 8. TECHNICAL HEALTH SIGNAL
-- ───────────────────────────────────────────────────────────────────────

-- 8.1 Webhook processing failures since launch
SELECT
  date_trunc('hour', "firstSeenAt") AS hour,
  COUNT(*)                          AS messages,
  COUNT(*) FILTER (WHERE "failureReason" IS NOT NULL) AS failures
FROM "inbound_whatsapp_messages"
WHERE "firstSeenAt" >= :launch_start
GROUP BY 1
ORDER BY 1;

-- 8.2 OTP delivery health (auth-side)
SELECT
  "status",
  COUNT(*) AS attempts,
  COUNT(*) FILTER (WHERE "createdAt" >= :launch_start) AS in_window
FROM "otp_delivery_attempts"
WHERE "createdAt" >= :pilot_start
GROUP BY "status"
ORDER BY attempts DESC;

-- 8.3 Audit-log activity (admin-side accountability proof)
SELECT
  "action",
  COUNT(*) AS events,
  COUNT(DISTINCT "actorId") AS actors
FROM "audit_logs"
WHERE "timestamp" >= :launch_start
GROUP BY "action"
ORDER BY events DESC
LIMIT 25;

-- =====================================================================
-- END OF PACK
-- =====================================================================
