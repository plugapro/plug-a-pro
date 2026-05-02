# 06 — Provider Opportunity Preview WhatsApp Flow

## Task

Implement or align WhatsApp opportunity preview for providers.

## Why

Providers must be able to understand a job opportunity without opening PWA.

## Safe preview fields

Show:

```text
category
subcategory
description summary
photos count
suburb
city
province
region
urgency
preferred date/time
budget preference if available
```

Do not show:

```text
customer phone
customer email
exact street address
house number
unit number
access notes
GPS coordinates
```

## WhatsApp message example

```text
🔔 New Job Opportunity — Plumbing

Area: Ruimsig, Roodepoort
Issue: Blocked shower drain
Preferred time: Today morning
Photos: 2 available

The customer is comparing suitable providers.

Reply:
1. Interested
2. Not interested
3. View photos
```

Optional PWA link:

```text
View full preview: {{lead_preview_url}}
```

## Implementation requirements

1. Generate safe WhatsApp preview from backend.
2. Ensure protected fields are not present in message payload.
3. Add photo count and optional photo viewing path.
4. Add interested / not interested quick replies if supported.
5. Add expiry/deadline if relevant.
6. Add tests.

## Acceptance criteria

- Provider receives safe preview in WhatsApp.
- No protected customer details appear.
- Provider can respond without PWA.
- Tests pass.
