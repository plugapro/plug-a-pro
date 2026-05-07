# 04 — Client PWA Request Creation Flow

## Task

Implement or align the Client PWA request creation screens for a WhatsApp-first, PWA-assisted request journey.

## Screens

1. Start / continue request
2. Service category
3. Subcategory
4. Problem description
5. Urgency and timing
6. Budget and provider preference
7. Review and submit

Photo and address are handled in the next file because they require stronger privacy/storage rules.

## WhatsApp-first behaviour

WhatsApp may start the request and then hand off to PWA for structured capture.

Example:

```text
WhatsApp: "Please complete your request details here: {{pwa_url}}"
PWA opens current request draft
Client completes details
PWA saves backend state
WhatsApp receives submission confirmation
```

## Data captured

```text
customer_name
mobile_e164
service_category
service_subcategory
job_type
description
urgency
preferred_date
preferred_time_window
provider_preference
budget_preference
max_call_out_fee optional
privacy_acknowledged
terms_acknowledged
```

## Provider preference options

```text
fastest_available
most_experienced
best_rated
budget_friendly
verified_only
```

## UX copy

Before submit, include:

```text
Your phone number and exact address will only be shared after you select a provider and that provider accepts the job.
```

## Implementation requirements

1. Reuse existing request form components where possible.
2. Support save-and-continue drafts.
3. Support WhatsApp-created draft continuing in PWA.
4. Validate required fields.
5. Keep UI mobile-first.
6. Use simple customer language.
7. Do not expose provider matching complexity to the customer.
8. Persist data incrementally where practical.
9. Add tests.

## Acceptance criteria

- Client can start request in PWA.
- Client can continue WhatsApp-created draft in PWA.
- Category/subcategory captured.
- Description captured.
- Urgency/timing captured.
- Provider preference captured.
- Budget preference captured.
- Review screen shows summary.
- Privacy acknowledgement shown.
- Tests pass.
