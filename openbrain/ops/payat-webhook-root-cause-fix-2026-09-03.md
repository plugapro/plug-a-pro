# engineering — Pay@ webhook root cause found + fixed: unsigned-doorbell mode, portal test GREEN (2026-09-03)

> Synced to OpenBrain 2026-09-07 (local CLI backend + Worker MCP).
> Tags: domain:engineering, payat, payments, webhook, root-cause

**Root cause of 0-for-all ITN delivery since May:** Pay@ never signs webhook calls. Their OpenAPI spec
(go.payat.co.za/yapi) offers webhook auth of NO_AUTH/BASIC/OAUTH2/API_KEY — never an HMAC — and the merchant
portal registers only a URL (NO_AUTH). Our route demanded a valid x-payat-signature HMAC, so every
notification was rejected 401. Two client-secret rotations were burned before reading their spec proved no
secret could ever fix it. Bonus bug: real payloads use accountNumber/referenceNumber/amountPaid
(IntegratorPaymentNotificationDetailsModel), not the clientReferenceNumber/status/amount fields we parsed.

**Fix — PR #205 (merged + deployed 2026-09-03):** new flag `payments.payat.webhook_unsigned_doorbell`.
Unsigned requests are doorbell-only: resolve the intent (reference chain, or accountNumber →
clientAccountNumber), then reconcilePayatIntent (from #203) asks Pay@ via rtp:read — payload status/amount
never read; payload-trusting legacy paths unreachable; forged requests can at worst trigger a verified read.
Unmatched payloads ack 200 (portal Test now SUCCEEDS — first time ever; prod log
payat.webhook_unsigned_unmatched confirmed). Read failures 5xx so Pay@ retries. 7 new tests; suite 5547 green.

**Prod state:** flags webhook_unsigned_doorbell + reconcile_sweep ON (H3 order); readback_verification OFF
(signed path can never fire). clientAccountNumber migration verified in prod (H2). PRs #202/#203/#204/#205
all merged to main.

**Still open:** (1) paste rotated client secret into PAYAT_CLIENT_SECRET — the Pay@Go portal OAuth client IS
the PAYAT_* rail (dashboard RTP refs are our intent cuids), so top-up RTP creation is broken until then;
(2) rtp:read grant on PAYAT_CLIENT_ID via Pay@ Get Help ticket — until granted, doorbell/sweep are safe but
cannot credit; (3) two stranded till-ref intents remain portal-manual.
