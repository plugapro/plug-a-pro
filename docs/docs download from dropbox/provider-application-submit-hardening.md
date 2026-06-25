# Provider application submit hardening

OpenBrain-compatible implementation note, 2026-05-05.

## Root cause

Trace `provider_app_submit_6216b36a-77f` failed during WhatsApp provider application submit because production schema drifted from the Prisma model.

The failing operation was:

- Operation: `providerCategory.createMany`
- Prisma error: `P2022`
- Model/table: `ProviderCategory` / `provider_categories`
- Missing column: `id`
- Failure class: schema drift / database constraint mismatch

Production still had an older `provider_categories` table:

- Primary key: `(providerId, categorySlug)`
- Columns: `providerId`, `categorySlug`, `addedAt`

Current Prisma and the submit flow expect:

- Primary key: `id`
- Unique key: `(providerId, categorySlug)`
- Enrichment fields: `categoryId`, `subServices`, `yearsExperience`, `skillLevel`, `approvalStatus`, certification fields, timestamps

`provider_rates` also had an older `rateCents/unit` shape and was repaired in the same migration to support current `callOutFee`, `hourlyRate`, and category-rate fields.

## Product decision

Provider application submission must validate required fields before DB writes, treat email and identity verification as optional for the WhatsApp MVP, use idempotent submit handling, and map DB constraint failures to recoverable user journeys with preserved progress.

## Required fields for WhatsApp submit

- Full name
- WhatsApp phone number
- At least one service/skill
- At least one service area
- Availability

## Optional for MVP submit

- Email
- ID/passport verification
- Profile photo
- Portfolio/evidence uploads
- Bio/profile enrichment

## Recovery behaviour

If required fields are missing, the flow blocks before DB writes and asks the provider to edit the application.

If a database/schema error occurs, the provider sees a non-technical retry message with a support reference. Internal logs include sanitized Prisma details such as model, column, constraint, target, and trace id.

Duplicate submits remain idempotent: existing pending or approved applications return the existing application status instead of creating another record.
