# 14 — WhatsApp Template and URL Audit

## Task to execute

Audit and update all WhatsApp templates and app links so they align to the Qualified Shortlist Model and use production public URLs.

## Why this is needed

WhatsApp is a primary channel. The wording and links must match the new flow. No provider or client should receive localhost links.

## Search for

```text
localhost
http://localhost
APP_PUBLIC_URL
PUBLIC_APP_URL
BASE_URL
Worker Portal
View Lead
terms
credit rules
Accept Lead
Unlock
provider selected
shortlist
application approved
request submitted
```

## Template groups

### Provider templates

```text
provider_onboarding_intro
provider_application_started
provider_application_submitted
provider_more_info_required
provider_approved
provider_rejected
new_job_opportunity_preview
provider_interest_captured
provider_not_interested_captured
customer_selected_provider
selected_job_accepted
selected_job_declined
insufficient_credits
credit_balance
lead_expired
```

### Client templates

```text
client_request_started
client_request_submitted
client_matching_started
client_provider_responses_pending
client_shortlist_ready
client_provider_selected
client_provider_accepted
client_provider_declined
client_more_options_needed
client_job_scheduled
client_job_completed
```

## URL requirements

1. Use central public URL helper.
2. Production base URL:

```text
https://app.plugapro.co.za
```

3. Production must never send localhost.
4. Local development may use localhost only when explicitly configured.
5. Links must be absolute.
6. Link generation should safely join paths.

## Acceptance criteria

- All WhatsApp templates align to the new model.
- Provider templates explain credit rules correctly.
- Client templates explain shortlist process clearly.
- No production WhatsApp message contains localhost.
- URLs open in WhatsApp in-app browser.
- Tests cover templates and URL helper.
- OpenBrain note is logged.

## Test cases

```text
provider approval renders production Worker Portal URL
provider terms URL is production URL
job URL is production URL
client ticket URL is production URL
template does not contain localhost
missing public URL fails safely in production
development can use localhost
```
