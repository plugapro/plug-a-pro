# Matching And Dispatch Incident Runbook

## Detect

- Requests remain in matching state past SLA.
- Queue breach alerts fire.
- Provider lead dispatch produces no response path.

## Triage

1. Check cron outcomes for `match-leads`.
2. Inspect dispatch decisions, lead rows, message events, and customer request status.
3. Confirm business-hours cadence and provider availability.
4. Verify no wallet/credit gate blocked eligible providers unexpectedly.

## Mitigate

- Use admin dispatch override only with audit log evidence.
- Avoid reranking loops that bypass the persisted queue.
- Communicate customer progress via approved WhatsApp copy.

## Close

Record request IDs, queue state, provider selection evidence, override actions, and follow-up automation gaps in OpenBrain.
