-- Plug A Pro — campaign funnel probe (read-only)
--
-- Purpose: reproduce the funnel numbers used in the daily ads conversion report
--          straight from the production database, without any other tooling.
--
-- How to run (one of the following):
--   a) Supabase CLI keychain token + Management API:
--        TOKEN=$(security find-generic-password -s "Supabase CLI" -w \
--          | sed 's/^go-keyring-base64://' | base64 -D)
--        curl -sS https://api.supabase.com/v1/projects/oghbryokdizklgwaqksp/database/query \
--          -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
--          -d "{\"query\": \"$(cat docs/marketing/sql/campaign-funnel-probe.sql | tr -d '\n')\"}"
--
--   b) Once Vercel dev DATABASE_URL/DIRECT_URL are rotated to aws-1, run via psql.
--
-- Parameters: edit :since once for the window you want.
-- All counts are real records only (excludes test cohort).

\set since '2026-06-15 00:00:00 UTC'

-- 1. Provider acquisition funnel
SELECT
  'provider_funnel' AS section,
  COUNT(*) FILTER (WHERE pa."submittedAt" >= :'since') AS applications_submitted,
  COUNT(*) FILTER (WHERE pa."submittedAt" >= :'since' AND pa.status = 'APPROVED') AS applications_approved,
  COUNT(*) FILTER (WHERE pa."submittedAt" >= :'since' AND pa.status = 'PENDING') AS applications_pending,
  COUNT(DISTINCT p.id) FILTER (WHERE p."createdAt" >= :'since') AS new_providers
FROM provider_applications pa
LEFT JOIN providers p ON p.id = pa."providerId"
WHERE pa."idNumber" NOT LIKE 'TEST%';

-- 2. Customer acquisition funnel
SELECT
  'customer_funnel' AS section,
  COUNT(*) FILTER (WHERE c."createdAt" >= :'since') AS new_customers,
  COUNT(*) FILTER (WHERE jr."createdAt" >= :'since') AS job_requests_submitted,
  COUNT(*) FILTER (WHERE jr."createdAt" >= :'since' AND jr.status = 'EXPIRED') AS job_requests_expired,
  COUNT(*) FILTER (WHERE jr."createdAt" >= :'since' AND jr.status = 'MATCHED') AS job_requests_matched,
  COUNT(*) FILTER (WHERE jr."createdAt" >= :'since' AND jr."utmCampaign" IS NOT NULL) AS job_requests_with_utm
FROM customers c
LEFT JOIN job_requests jr ON jr."customerId" = c.id
WHERE COALESCE(c."archivedAt", '1970-01-01') < c."createdAt";

-- 3. UTM-tagged job requests grouped by campaign + content (creative variant)
SELECT
  'utm_breakdown' AS section,
  jr."utmSource",
  jr."utmMedium",
  jr."utmCampaign",
  jr."utmContent",
  COUNT(*) AS requests,
  COUNT(*) FILTER (WHERE jr.status = 'MATCHED') AS matched,
  COUNT(*) FILTER (WHERE jr.status = 'EXPIRED') AS expired
FROM job_requests jr
WHERE jr."createdAt" >= :'since'
  AND jr."utmCampaign" IS NOT NULL
GROUP BY 2, 3, 4, 5
ORDER BY requests DESC;

-- 4. Lead dispatch + acceptance — what happens after a paid request lands
SELECT
  'lead_dispatch' AS section,
  COUNT(*) FILTER (WHERE l."createdAt" >= :'since') AS leads_dispatched,
  COUNT(*) FILTER (WHERE l."createdAt" >= :'since' AND l.status = 'ACCEPTED') AS leads_accepted,
  COUNT(*) FILTER (WHERE l."createdAt" >= :'since' AND l.status = 'EXPIRED') AS leads_expired,
  COUNT(*) FILTER (WHERE l."createdAt" >= :'since' AND l.status = 'DECLINED') AS leads_declined,
  COUNT(DISTINCT l."jobRequestId") FILTER (WHERE l."createdAt" >= :'since') AS distinct_job_requests_dispatched
FROM "Lead" l;

-- 5. WhatsApp 24h-window failure flag — count of failed lead-action sends since window
SELECT
  'whatsapp_window_failures' AS section,
  COUNT(*) AS failed_sends,
  COUNT(DISTINCT me."recipient") AS distinct_recipients,
  ARRAY_AGG(DISTINCT me."templateName") AS templates
FROM "MessageEvent" me
WHERE me."createdAt" >= :'since'
  AND me.status = 'FAILED'
  AND me."errorCode" IN ('131047', '131051'); -- 24h re-engagement window codes

-- 6. Daily 7-day trend (run separately if your client struggles with multi-statement responses)
SELECT
  date_trunc('day', day)::date AS day,
  (SELECT COUNT(*) FROM provider_applications pa WHERE pa."submittedAt"::date = day::date) AS provider_apps,
  (SELECT COUNT(*) FROM customers c WHERE c."createdAt"::date = day::date) AS new_customers,
  (SELECT COUNT(*) FROM job_requests jr WHERE jr."createdAt"::date = day::date) AS job_requests,
  (SELECT COUNT(*) FROM "Lead" l WHERE l."createdAt"::date = day::date) AS leads_sent
FROM generate_series(now() - interval '7 days', now(), interval '1 day') AS day
ORDER BY day;
