# Plug-A-Pro SLOs

## Production Journey SLOs

| SLO | Target | Measurement source | Alert threshold | Owner type |
| --- | --- | --- | --- | --- |
| `/api/health` availability | 99.9% monthly | health endpoint probe | 2 failed probes in 5 minutes | platform/SRE |
| Customer booking submission latency | p95 under 2.5s | API duration logs | p95 above 4s for 15 minutes | engineering |
| WhatsApp outbound delivery creation | p95 under 30s | `message_events` created/failed counts | failure rate above 5% for 10 minutes | operations |
| Lead matching dispatch | p95 under 5 minutes after request validation | match/dispatch events | no dispatch event after 10 minutes | operations |
| Provider credit payment application | p95 under 5 minutes after valid callback | payment intent + wallet ledger timestamps | callback without ledger after 10 minutes | operations + finance |
| Attachment proxy success | 99% daily | attachment proxy status codes | 5xx rate above 2% for 10 minutes | engineering + security |
| Admin queue freshness | p95 queue age below configured SLA | ops dashboard queue metrics | breached items without owner after 15 minutes | operations |

## Evidence Required

- Metrics source or query.
- Dashboard tile or alert reference.
- Last successful synthetic probe, when available.
- OpenBrain incident or implementation note for any breach.

## Evidence Register

Current status: dashboards/alerts are being stood up. Keep this table in "pending/observed" states until linked evidence exists in OpenBrain.

| SLO | Metric query or source | Dashboard / alert reference | Current baseline | Last synthetic probe |
| --- | --- | --- | --- | --- |
| `/api/health` availability | External synthetic against `/api/health` + internal build metadata (`db`, `whatsapp`, `payments`, `auth.supabase_env_complete`) | `TODO dashboard: ops-health-overview` ; `TODO alert: slo-health-unavailable` | Not measured | Not run |
| Customer booking submission latency | Route duration logs for booking submission and create-booking queue handoff | `TODO dashboard: ops-booking-slo` ; `TODO alert: slo-booking-p95` | Not measured | Not run |
| WhatsApp outbound delivery creation | `MessageEvent` success/error counts + `message_events` lag by template/provider | `TODO dashboard: ops-whatsapp-sla` ; `TODO alert: slo-whatsapp-delivery` | Not measured | Not run |
| Lead matching dispatch | `created_at` on `JobRequest` and first `LeadDispatchEvent` timestamp | `TODO dashboard: ops-dispatch-latency` ; `TODO alert: slo-dispatch-delay` | Not measured | Not run |
| Provider credit payment application | Callback receive timestamp vs wallet ledger apply timestamp | `TODO dashboard: ops-payment-credit` ; `TODO alert: slo-payment-credit-lag` | Not measured | Not run |
| Attachment proxy success | `/api/attachments/[id]` status and duration distribution from structured logs | `TODO dashboard: ops-attachments` ; `TODO alert: slo-attachment-errors` | Not measured | Not run |
| Admin queue freshness | Queue age by owner and ownership SLA (queue table + audit trail lag) | `TODO dashboard: ops-admin-queue` ; `TODO alert: slo-admin-queue-stale` | Not measured | Not run |

## CI And Preview Smoke Evidence

| Gate | Evidence required | Current implementation |
| --- | --- | --- |
| Pure build | `pnpm install --frozen-lockfile`, typecheck, build | Always-on field-service CI build job |
| Live start smoke | Explicit repo variable opt-in and secret preflight | `FIELD_SERVICE_LIVE_SMOKE=true` required before live DB/payment/WhatsApp smoke runs |
| Preview E2E smoke | Preview `/api/health` `build.commitSha` equals the GitHub SHA under test; health smoke script should include integration checks (`db`, `auth.supabase_env_complete`, optional external components) | `FIELD_SERVICE_E2E_SMOKE=true` required before Playwright runs |

## Runbook Evidence

- Add dashboard IDs and alert links in this document as they are provisioned.
- Store each SLO breach response in an OpenBrain implementation note with:
  - `owner`, `timestamp`, `root cause`, `mitigation`, `recovery metric`, `follow-up task`.
