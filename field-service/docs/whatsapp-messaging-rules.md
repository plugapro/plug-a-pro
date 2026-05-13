# WhatsApp Messaging Rules

## Raw URL Rule

Never place raw URLs in WhatsApp message bodies. Use short CTA labels and place the actual URL only in WhatsApp CTA URL buttons, template URL button payloads, or supported interactive message components.

This applies to customer-facing and provider-facing WhatsApp copy, including signed access links, deep links, worker portal links, request trackers, lead previews, provider profiles, credit rules, credit history, support links, and payment links.

## Required CTA Labels

- `view_lead`: View lead
- `view_job`: View job
- `view_request`: View request
- `view_provider`: View provider
- `accept_job`: Accept job
- `check_status`: Check status
- `worker_portal`: Open Worker Portal
- `credits_rules`: View credits rules
- `credits_history`: View credits history
- `provider_status`: View status
- `support`: Contact support
- `generic_details`: View details

## Examples

Bad:

```text
View job details - https://app.plugapro.co.za/leads/access/{token}
```

Good:

```text
Your job lead is ready.
CTA: View lead
```

Bad:

```text
Credit history: https://app.plugapro.co.za/provider/credits
```

Good:

```text
Credits history is available below.
CTA: View credits history
```

## Enforcement

`lib/whatsapp-copy.ts` owns the CTA label mapping and visible-body guard. All WhatsApp senders must call the central send pipeline so `assertNoRawUrlsInWhatsAppBody()` can block raw URLs, tokenized access paths, and JWT-looking strings before delivery.
