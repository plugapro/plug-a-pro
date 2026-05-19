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

Current status: production dashboards and alert links are not yet attached. Do not treat the SLOs above as proven until every row below has real evidence.

| SLO | Metric query or source | Dashboard / alert reference | Current baseline | Last synthetic probe |
| --- | --- | --- | --- | --- |
| `/api/health` availability | Pending: external HTTP probe plus `/api/health` response log | Pending | Not collected | Not run |
| Customer booking submission latency | Pending: API duration log grouped by booking submission route | Pending | Not collected | Not run |
| WhatsApp outbound delivery creation | Pending: `message_events` created/failed counts by template and provider | Pending | Not collected | Not run |
| Lead matching dispatch | Pending: request validation timestamp to first dispatch event | Pending | Not collected | Not run |
| Provider credit payment application | Pending: payment callback timestamp to wallet ledger timestamp | Pending | Not collected | Not run |
| Attachment proxy success | Pending: `/api/attachments/[id]` status-code and duration logs | Pending | Not collected | Not run |
| Admin queue freshness | Pending: queue age by owner and SLA policy | Pending | Not collected | Not run |

## CI And Preview Smoke Evidence

| Gate | Evidence required | Current implementation |
| --- | --- | --- |
| Pure build | `pnpm install --frozen-lockfile`, typecheck, build | Always-on field-service CI build job |
| Live start smoke | Explicit repo variable opt-in and secret preflight | `FIELD_SERVICE_LIVE_SMOKE=true` required before live DB/payment/WhatsApp smoke runs |
| Preview E2E smoke | Preview `/api/health` `build.commitSha` equals the GitHub SHA under test | `FIELD_SERVICE_E2E_SMOKE=true` required before Playwright runs |
