# 03 — Shared Data Model and Migration Plan

## Task to execute

Design and implement the shared data model foundation needed for provider onboarding, client requests, matching, shortlist, provider acceptance, and credits.

## Why this is needed

The Qualified Shortlist Model requires clean separation between:

- Provider profile
- Client service request
- Lead invite
- Provider response
- Customer shortlist
- Job
- Credit ledger

Do not mix all states into one table if the current schema already separates them. Reuse existing schema where possible.

## Investigation first

From the as-is assessment, identify current equivalents for:

```text
providers
provider applications
provider categories
provider service areas
provider availability
provider rates
customers
customer addresses
service requests
request attachments
lead invites
provider lead responses
shortlists
jobs
credit balances
credit ledger
job activity log
notifications
```

## Target entities

### providers

Needed fields:

```text
id
user_id
first_name
last_name
mobile_e164
email
status
verification_level
trust_level
profile_photo_attachment_id
short_bio
provider_type
created_at
updated_at
approved_at
approved_by
suspended_at
suspended_reason
```

### provider_categories

Needed fields:

```text
id
provider_id
category_id
sub_services
years_experience
skill_level
approval_status
certification_required
certification_status
created_at
updated_at
```

### provider_service_areas

Needed fields:

```text
id
provider_id
province
region
city
suburb
normalized_suburb
travel_radius_km
active
```

### provider_availability

Needed fields:

```text
id
provider_id
day_of_week
start_time
end_time
same_day_available
emergency_available
weekend_available
```

### provider_rates

Needed fields:

```text
id
provider_id
category_id
call_out_fee
hourly_rate
day_rate
rate_negotiable
quote_after_inspection
```

### service_requests

Needed fields:

```text
id
request_ref
customer_id
customer_address_id
source
category_id
subcategory_id
description
urgency
preferred_date
preferred_time_window
budget_preference
max_call_out_fee
provider_preference
verified_only
risk_level
certified_provider_required
status
created_at
submitted_at
```

### lead_invites

Needed fields:

```text
id
request_id
provider_id
match_run_id
status
match_score
ranking_position
safe_preview_token
expires_at
viewed_at
responded_at
customer_selected_at
provider_accepted_at
expired_at
cancelled_at
created_at
```

### provider_lead_responses

Needed fields:

```text
id
lead_invite_id
provider_id
response
call_out_fee
estimated_arrival_at
rate_type
rate_amount
negotiable
provider_note
created_at
```

### provider_shortlists and provider_shortlist_items

Needed fields:

```text
shortlist.id
shortlist.request_id
shortlist.status
shortlist.created_at
shortlist.published_at

item.id
item.shortlist_id
item.lead_invite_id
item.provider_id
item.rank
item.match_score
item.display_call_out_fee
item.display_arrival_time
item.customer_selected_at
```

### jobs

Needed fields:

```text
id
job_ref
request_id
customer_id
provider_id
selected_lead_invite_id
status
assigned_at
scheduled_arrival_at
arrival_time_confirmed_at
completed_at
cancelled_at
created_at
```

### credit_balances and credit_ledger

Needed fields:

```text
credit_balances.provider_id
available_credits
starter_credits
purchased_credits
reserved_credits
updated_at

credit_ledger.provider_id
transaction_type
amount
balance_before
balance_after
starter_balance_after
purchased_balance_after
request_id
job_id
lead_invite_id
reason
source
idempotency_key
trace_id
created_at
```

## Implementation requirements

1. Reuse existing tables if they already exist.
2. Add missing fields through safe migrations.
3. Add indexes for lookup-heavy fields:
   - provider mobile
   - request status
   - lead invite status
   - provider + status
   - request + status
   - normalized suburb
4. Add unique constraints where safe:
   - provider mobile E.164
   - credit ledger idempotency key
   - provider lead invite per request/provider/match run, if applicable
5. Create a migration plan for existing data.
6. Create dry-run remediation scripts where needed.
7. Do not destroy existing production data.
8. Add seed/test fixtures for the new model.

## Good output

- Migration files
- Updated schema/types
- Data remediation plan
- Seed updates
- Tests for model constraints
- OpenBrain schema decision log

## Acceptance criteria

- Schema supports all three journeys.
- Existing data can be mapped or migrated.
- Lead invite and job are distinct.
- Credit ledger is not replaced by direct balance mutation only.
- Privacy-sensitive address fields remain separate.
- Tests pass.
