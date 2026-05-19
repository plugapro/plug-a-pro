# Auth And OTP Incident Runbook

## Detect

- `/api/health` auth fields degrade.
- OTP send/verify returns elevated 429 or 503 responses.
- Rate-limit degraded events increase.

## Triage

1. Confirm Supabase Auth status.
2. Confirm Upstash Redis health and env presence.
3. Check WhatsApp delivery health when OTP is routed through WhatsApp.
4. Review recent deploys that touched auth, rate limits, or proxy/session code.

## Mitigate

- If Redis is down, keep production fail-closed and route users to support.
- If WhatsApp is down, disable WhatsApp OTP hook at the provider dashboard only after security approval.
- Do not bypass OTP or make auth fail open.

## Close

Log incident summary, affected routes, duration, user impact, tests run, and follow-up controls in OpenBrain.
