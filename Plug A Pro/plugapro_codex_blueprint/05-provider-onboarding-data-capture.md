# 05 — Provider Onboarding Data Capture

## Task to execute

Upgrade provider onboarding to capture the minimum data required for trust-aware matching.

## Why this is needed

The matching engine needs provider skills, experience, areas, availability, rates, and trust evidence to shortlist suitable providers.

## Required provider data

### Personal details

```text
first_name
last_name
mobile_e164
alternate_mobile_e164
email
preferred_language
id_number_or_passport
residential_suburb
residential_city
residential_province
```

### Business profile

```text
provider_type
trading_name
company_registration_number
vat_number
team_size
short_bio
profile_photo_id
```

### Services and experience

```text
service_categories
sub_services
years_experience_per_category
skill_level_per_category
has_tools
emergency_available
certifications
```

### Work areas

```text
province
region
city
suburbs
normalized_suburbs
travel_radius_km
willing_to_travel
```

### Availability

```text
working_days
working_hours
same_day_jobs
weekend_jobs
emergency_jobs
```

### Rates

```text
call_out_fee
hourly_rate
day_rate
rate_negotiable
quote_after_inspection
emergency_surcharge
```

### Trust evidence

```text
id_document_attachment_id
previous_work_photos
reference_1_name
reference_1_mobile
reference_2_name
reference_2_mobile
certifications_attachment_ids
```

## Implementation requirements

1. Reuse existing WhatsApp onboarding state machine where possible.
2. Add missing capture steps.
3. Validate South African phone numbers consistently.
4. Validate rate fields as numeric where applicable.
5. Store service areas in structured records, not only free text.
6. Store display place names in proper case.
7. Keep normalized location keys for matching.
8. Store uploads in app-controlled storage.
9. Do not mark application complete if required uploads fail.
10. Add provider-facing copy explaining why the data is needed.

## WhatsApp copy direction

Provider intro should explain:

```text
application
review before approval
starter credits on approval
1 credit per accepted customer-selected job
full customer details unlock after acceptance
terms URL
```

Do not mention “promo pilot phase”.

## Acceptance criteria

- Provider can complete onboarding with the target required fields.
- Onboarding remains mobile-first and WhatsApp-friendly.
- Provider data is structured enough for matching.
- Uploaded files are linked to the application/provider.
- Incomplete applications are not treated as approved.
- Tests cover happy path and validation errors.
- OpenBrain implementation note is logged.

## Test cases

```text
provider submits required personal details
provider selects service categories
provider enters years of experience
provider adds service areas
provider enters call-out fee and negotiable flag
provider uploads profile photo
provider uploads previous work photos
invalid mobile number rejected
invalid fee rejected
missing required field blocks submission
application submitted status set correctly
```
