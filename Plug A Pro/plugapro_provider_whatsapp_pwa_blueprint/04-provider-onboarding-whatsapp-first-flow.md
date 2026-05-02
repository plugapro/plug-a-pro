# 04 — Provider Onboarding WhatsApp-First Flow

## Task

Implement or align provider onboarding so it can be completed end to end in WhatsApp.

PWA application form may exist, but WhatsApp must be sufficient.

## Required onboarding capture

```text
full name
mobile number
email optional
ID/passport where applicable
provider type
service categories
sub-services
years of experience
skill level
work areas/suburbs
availability
call-out fee
rate / negotiable flag
profile photo
previous work photos where possible
references where possible
terms acceptance
```

## WhatsApp onboarding flow

```text
Provider sends Register / Find Work
↓
Intro explains application, review, credits, and terms
↓
Provider captures details step by step
↓
Provider uploads photos/documents where possible
↓
Provider accepts terms
↓
Application submitted
↓
Admin reviews
```

## Intro copy

```text
Join Plug A Pro as a Service Provider.

You can apply through WhatsApp. We review applications before providers receive job opportunities.

If approved, you receive starter credits.
Each customer-selected job you accept uses 1 credit.
Full customer details unlock only after acceptance.

Reply YES to apply.
```

## Implementation requirements

1. Reuse existing provider onboarding flow.
2. Add missing WhatsApp capture steps.
3. Allow provider to pause and continue.
4. Validate phone/rate/location fields.
5. Store structured service categories and work areas.
6. Upload media to app-controlled storage.
7. Do not mark application submitted if required fields are missing.
8. Send application submitted confirmation.
9. Add tests.

## Acceptance criteria

- Provider can apply fully via WhatsApp.
- PWA is optional.
- Application has required structured data.
- Application submitted confirmation sent.
- Tests pass.
