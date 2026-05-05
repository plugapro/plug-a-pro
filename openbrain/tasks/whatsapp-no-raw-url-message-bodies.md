# WhatsApp no raw URL body rule

Status: implemented
Date: 2026-05-05

Decision:
Provider and customer-facing WhatsApp messages must never expose raw URLs. URLs must be sent through CTA/template button payloads with short action labels such as View credit history, View credit policy, View quote, or Open Worker Portal.

Implementation notes:
- `lib/whatsapp-copy.ts` owns CTA purposes and labels.
- `sendText`, `sendButtons`, `sendList`, `sendCtaUrl`, and template body/header parameters assert that visible body text contains no raw URL.
- Provider credit summaries use `Credit history is available below.` and send the actual `/provider/credits` URL only through a `View credit history` CTA.
- URL-bearing legacy template senders now place URLs in URL button components instead of body parameters.
