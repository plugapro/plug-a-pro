# 11 — Provider Opportunity Preview and Response

## Task to execute

Implement provider safe preview and interest/rate response for matched opportunities.

## Why this is needed

In the Qualified Shortlist Model, providers are not charged for previewing or expressing interest. They respond with rate and availability so the client can compare options.

## Provider preview fields

Provider may see:

```text
category
subcategory
description
photos
suburb
city
province
region
urgency
preferred date/time
budget preference, if provided
```

Provider must not see:

```text
customer phone
customer email
exact street address
house number
unit/apartment number
complex access details
GPS coordinates
private access notes
```

## WhatsApp opportunity message

```text
🔔 New Job Opportunity — {{category}}

Area: {{suburb}}, {{city}}
Issue: {{short_description}}
Preferred time: {{preferred_time}}
Urgency: {{urgency}}

The customer is comparing suitable providers.

Reply Interested and confirm:
• call-out fee
• estimated arrival time
• rate or negotiable
```

Actions:

```text
Interested
Not interested
```

## Provider response fields

```text
response
call_out_fee
estimated_arrival_at
rate_type
rate_amount
negotiable
provider_note
```

## Implementation requirements

1. Create or update safe lead preview endpoint/page.
2. Enforce privacy server-side.
3. Send WhatsApp opportunity to top matched providers.
4. Capture provider response.
5. Validate call-out fee and arrival time.
6. Mark lead invite as interested or not_interested.
7. Do not deduct credits.
8. Do not reveal full customer details.
9. Add expiry handling for non-responses.
10. Add idempotency for duplicate WhatsApp events.

## Acceptance criteria

- Provider receives safe preview.
- Provider can respond interested.
- Provider can submit call-out fee.
- Provider can submit estimated arrival.
- Provider can mark rate as negotiable.
- Provider can decline/not interested.
- Provider does not see full customer details.
- No credits are deducted.
- Tests pass.

## Test cases

```text
safe preview excludes customer phone
safe preview excludes exact address
safe preview includes photos
provider responds interested
provider response saves call-out fee
provider response saves estimated arrival
provider response saves negotiable flag
provider declines
expired invite cannot respond
duplicate response handled safely
```
