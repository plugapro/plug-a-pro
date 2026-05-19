# WhatsApp Incident Runbook

## Detect

- Message event failure rate breaches SLO.
- Webhook verification errors increase.
- `/api/health` reports WhatsApp `error`.

## Triage

1. Check Meta status and WhatsApp app credentials.
2. Verify webhook signature errors are not caused by secret mismatch.
3. Review message event failures by template/type.
4. Confirm raw URL guard did not block malformed outgoing messages.

## Mitigate

- Pause non-critical marketing sends.
- Keep utility/customer operational messages prioritized.
- Do not expose signed URLs in message bodies.

## Close

Record failed templates, provider/customer impact, replay actions, and remaining Meta/support actions in OpenBrain.
