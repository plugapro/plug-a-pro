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
