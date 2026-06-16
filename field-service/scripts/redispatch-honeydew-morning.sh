#!/usr/bin/env bash
# Manual fallback trigger for the 2026-06-17 07:33 SAST Honeydew lead recovery.
# Run this only if the Claude-scheduled cron (dde8e6a0) did not fire.
set -euo pipefail
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -D)
API="https://api.supabase.com/v1/projects/oghbryokdizklgwaqksp/database/query"
HANDYMAN_JR="cmqf77w0o002nl404e35wyhkp"
HANDYMAN_PROVIDER_ID="ee63cef7-00ed-4298-b4c7-a7cf98f17d04"
GARDEN_JR="cmqffbtol00b3jv04njepz6tc"
GARDEN_PROVIDER_ID="ff751f2a-4c5f-4853-9f1e-c328db42f45c"
run_sql() {
  local sql="$1"
  curl -sS "$API" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    -d "$(printf '{"query": %s}' "$(printf '%s' "$sql" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")"
  echo
}
echo "── re-open both job requests + bias dispatch to preferred providers ──"
run_sql "
UPDATE job_requests SET status='OPEN', \"preferredProviderId\"='${HANDYMAN_PROVIDER_ID}', \"assignmentMode\"='AUTO_ASSIGN', \"expiresAt\"=now()+interval '4 hours', \"updatedAt\"=now()
WHERE id='${HANDYMAN_JR}' AND status='EXPIRED' RETURNING id, status::text, \"preferredProviderId\";
UPDATE job_requests SET status='OPEN', \"preferredProviderId\"='${GARDEN_PROVIDER_ID}', \"assignmentMode\"='AUTO_ASSIGN', \"expiresAt\"=now()+interval '4 hours', \"updatedAt\"=now()
WHERE id='${GARDEN_JR}' AND status='EXPIRED' RETURNING id, status::text, \"preferredProviderId\";
"
echo "── verify dispatch fired (run after 60-90s) ──"
echo 'TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed "s/^go-keyring-base64://" | base64 -D) \'
echo '&& curl -sS https://api.supabase.com/v1/projects/oghbryokdizklgwaqksp/database/query \'
echo '   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \'
echo "   -d '{\"query\":\"SELECT l.\\\"jobRequestId\\\", l.status::text, l.\\\"sentAt\\\", l.\\\"viewedAt\\\", l.\\\"providerAcceptedAt\\\", me.\\\"templateName\\\", me.status::text AS msg_status, me.\\\"deliveredAt\\\", me.\\\"readAt\\\" FROM leads l LEFT JOIN message_events me ON me.\\\"to\\\" = (SELECT phone FROM providers WHERE id = l.\\\"providerId\\\") AND me.\\\"createdAt\\\" BETWEEN l.\\\"sentAt\\\" - interval ''1 minute'' AND l.\\\"sentAt\\\" + interval ''5 minutes'' WHERE l.\\\"jobRequestId\\\" IN (''${HANDYMAN_JR}'', ''${GARDEN_JR}'') AND l.\\\"sentAt\\\" >= now() - interval ''2 hours'' ORDER BY l.\\\"sentAt\\\";\"}' | jq"
