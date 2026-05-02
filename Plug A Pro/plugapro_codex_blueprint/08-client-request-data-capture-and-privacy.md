# 08 — Client Request Data Capture and Privacy

## Task to execute

Upgrade the client service request flow to capture the data required for matching while protecting customer privacy.

## Why this is needed

The system needs enough information to match suitable providers, but providers must not receive exact customer contact/location details before acceptance.

## Required client request data

### Customer

```text
customer_name
mobile_e164
email optional
request_source
```

### Service

```text
service_category
service_subcategory
job_type
risk_level system-derived
certified_provider_required system-derived
```

### Problem details

```text
description
issue_started_at optional
active_damage optional
previous_attempted_fix optional
special_notes optional
```

### Attachments

```text
photos strongly recommended
videos optional
attachment_status
storage_path
mime_type
safe_for_preview
```

### Location

Visible before provider acceptance:

```text
province
region
city
suburb
```

Hidden until provider acceptance:

```text
street_address
house_number
complex_name
unit_number
access_notes
latitude
longitude
postal_code
```

### Timing

```text
urgency
preferred_date
preferred_time_window
alternative_time_window optional
flexible_time optional
```

### Budget and preference

```text
budget_preference optional
max_call_out_fee optional
provider_preference optional
verified_only optional
quote_required system-derived
```

Provider preference values:

```text
fastest_available
most_experienced
best_rated
budget_friendly
verified_only
```

## Implementation requirements

1. Add missing fields to request capture UI/WhatsApp flow.
2. Keep the flow mobile-first and not too heavy.
3. Store exact address separately from general area.
4. Return only safe preview fields to providers before acceptance.
5. Store attachments in app-controlled storage.
6. Do not rely on temporary WhatsApp media URLs.
7. Use proper-case place names for display and normalized keys for matching.
8. Add request review step before submission.
9. Include privacy explanation to client.

## Client review message

```text
Please confirm your request:

Service: {{category}} — {{subcategory}}
Area: {{suburb}}, {{city}}
Urgency: {{urgency}}
Preferred time: {{preferred_time}}
Preference: {{provider_preference}}
Photos: {{photo_count}} uploaded

Your phone number and exact address will only be shared after you select a provider and that provider accepts the job.
```

## Acceptance criteria

- Client can capture all required request fields.
- Request has enough data for matching.
- Photos are uploaded and linked correctly.
- Exact address is hidden from provider preview.
- Safe preview includes category, description, photos, suburb, city, province, urgency, preferred time.
- Tests pass.

## Test cases

```text
client submits plumbing request
client submits handyman request
client uploads one photo
client uploads multiple photos
request stores full address
safe preview hides exact address
safe preview hides customer phone
safe preview shows suburb/city/province
request preference saved
request urgency saved
photo upload failure handled
```
