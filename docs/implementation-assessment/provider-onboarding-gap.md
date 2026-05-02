# Provider Onboarding Gap Assessment

## Current flow

Provider onboarding starts in WhatsApp through `field-service/lib/whatsapp-flows/registration.ts`.

Trigger keywords include:

```text
register, join, technician, provider, apply, signup, sign up,
i want to work, want to work, looking for work, find work,
i want work, need work, find a job, get work
```

Current flow:

1. WhatsApp registration trigger starts `handleRegistrationFlow`.
2. Existing provider/customer/application checks prevent duplicate role conflicts.
3. Provider sees onboarding intro from `buildProviderOnboardingIntroMessage`.
4. Provider submits full name.
5. Provider selects one or more service skills.
6. Provider selects province/city/region/suburbs or enters fallback service area text.
7. Provider selects experience.
8. Provider selects availability.
9. Provider optionally adds a proof note or up to 5 evidence files.
10. Provider reviews a WhatsApp summary.
11. Provider submits.
12. System creates/updates an unverified provider record and creates a pending `ProviderApplication`.
13. Admin reviews in `/admin/applications`.
14. Admin can approve or reject.
15. Approval syncs the provider record, creates/links a Supabase auth user, awards starter promo credits, releases onboarding queue item, sends approval WhatsApp, and checks waiting jobs.

## Current captured fields

| Field | Captured today | Storage |
|---|---:|---|
| Full name | Yes | `ProviderApplication.name`, `Provider.name` |
| Mobile number | Yes | `ProviderApplication.phone`, `Provider.phone` |
| Service categories / skills | Yes | `ProviderApplication.skills`, `Provider.skills`, `TechnicianSkill` |
| Structured service areas | Yes where location nodes exist | `ProviderApplication.serviceAreas`, `Provider.serviceAreas`, `TechnicianServiceArea` |
| Experience | Yes, coarse text | `ProviderApplication.experience`, `Provider.experience` via sync only if populated elsewhere |
| Availability | Yes, coarse text/day set | `ProviderApplication.availability`, `TechnicianAvailability` default on approval |
| Evidence note | Yes, optional | `ProviderApplication.evidenceNote` |
| Evidence files | Yes, optional up to 5 | `Attachment.providerApplicationId`, `ProviderApplication.evidenceFileUrls` |
| ID number/passport | Schema field exists | `ProviderApplication.idNumber`; not captured in current WhatsApp flow |
| Profile photo | No dedicated capture | `Provider.avatarUrl` exists; no application profile photo step |
| Rates | No | Step 3 added `ProviderRate`, not yet captured |
| References | No | No first-class fields yet |
| Certifications | Partially | Existing `TechnicianCertification` and `ProviderCertification`; current onboarding only accepts generic evidence files |
| Alternate mobile/email/language | No | `Provider.email` exists; not captured in WhatsApp flow |
| Business profile | No | Some `Provider` fields exist; not captured as a structured onboarding section |

## Current data storage

| Data | Storage |
|---|---|
| Provider identity/profile | `Provider` |
| Application record | `ProviderApplication` |
| Provider skills | `Provider.skills`, `TechnicianSkill` |
| Provider service areas | `Provider.serviceAreas`, `TechnicianServiceArea` |
| Availability | `TechnicianAvailability`; defaulted to available on approval |
| Evidence uploads | `Attachment` rows linked to `ProviderApplication` |
| Approval queue ownership | `OpsQueueAssignment` with `PROVIDER_ONBOARDING` |
| Approval audit | `crudAction`, `AuditLog`, admin action messages |
| Starter credits | `ProviderWallet`, `WalletLedgerEntry`, `ProviderPromoAward` |

## Current statuses

| Current status source | Values |
|---|---|
| `ProviderApplication.status` | `PENDING`, `APPROVED`, `REJECTED` |
| `Provider.status` | `APPLICATION_PENDING`, `UNDER_REVIEW`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`, `BANNED` |
| `Provider.verified` | Current marketplace approval flag for matching/unlock |
| `Provider.kycStatus` | `NOT_STARTED`, `IN_PROGRESS`, `SUBMITTED`, `VERIFIED`, `REJECTED`, `EXPIRED` |

There is no first-class `MORE_INFO_REQUIRED` application status today.

## Current admin review process

Admin review lives in `field-service/app/(admin)/admin/applications/page.tsx`.

Admin capabilities today:

| Capability | Current state |
|---|---|
| View pending/reviewed applications | Yes |
| See name/phone/skills/area/experience/availability/ref | Yes |
| Claim/release application queue item | Yes |
| Approve application | Yes |
| Reject application with optional reason | Yes |
| Detect duplicate active applications by phone | Yes |
| Create/link provider portal auth user | Yes, via Supabase admin create/update |
| Award starter credits | Yes, via `awardMobileVerifiedPromoCreditsInTransaction` |
| Send approval/rejection WhatsApp | Yes |
| Request more information | No |
| Approve/reject specific categories | No first-class workflow |
| Set verification/trust level | Not as a dedicated review action |
| View evidence thumbnails/files inline | Evidence is stored, but application list does not show file review UI |
| View references | No references captured |

## Current WhatsApp templates

Relevant template/copy sources:

| File | Current onboarding copy/templates |
|---|---|
| `field-service/lib/provider-credit-copy.ts` | `buildProviderOnboardingIntroMessage`, `buildProviderApplicationSubmittedMessage` |
| `field-service/lib/messaging-templates.ts` | `technician_application_received`, `technician_welcome`, `technician_application_declined` |
| `field-service/lib/provider-application-notifications.ts` | Approval notification idempotency |
| `field-service/lib/whatsapp-bot.ts` | `notifyTechnicianApplicationResult` |

Current copy already explains application review, starter credits, 1 credit per accepted lead, detail unlock after acceptance, and provider terms. It still uses some "technician" terminology and current paid-lead language rather than selected-job shortlist language.

## Gaps against target onboarding

| Target | Current gap |
|---|---|
| Personal details | Captures full name and phone only; no first/last split, alternate mobile, email, preferred language, residential location, ID/passport capture in flow |
| Business profile | No provider type, trading name, registration, VAT, team size, short bio, profile photo capture |
| Services and experience | Captures skills and coarse experience; no per-category years, skill level, sub-services, tools, emergency availability per category |
| Work areas | Structured areas exist; travel radius/willingness to travel not captured in onboarding |
| Availability | Coarse weekday/weekend availability captured; no working hours or emergency/same-day detail beyond defaults |
| Rates | Not captured yet |
| Trust evidence | Optional note/files exist; no structured ID document, previous work photos, references, or certification attachment classification |
| Admin review | Approve/reject exists; no more-info request, category-level approval, verification level, trust level, document viewer, reference review |
| Customer-visible profile | Provider profile route exists under `field-service/app/(customer)/providers/[id]/page.tsx`, but onboarding does not gather enough structured display data for rich shortlist cards |
| KYC | `kycStatus` exists but current approval/matching primarily uses `verified` |

## Recommended reuse

1. Keep WhatsApp-first onboarding and extend `registration.ts` steps rather than adding a duplicate onboarding system.
2. Reuse `ProviderApplication` as the application intake record.
3. Reuse `Attachment` for profile photos, ID documents, certifications, and previous work photos, adding labels/classification instead of new storage.
4. Reuse `TechnicianSkill`, `ProviderCategory`, and `ProviderRate` for structured matching and shortlist card data.
5. Reuse `TechnicianServiceArea` and `LocationNode` for structured service areas.
6. Reuse `ProviderPromoAward` and wallet ledger functions for starter credits.
7. Reuse admin application page and `crudAction` for new review actions.

## Required changes

1. Add WhatsApp capture steps for required personal/business/rate/trust fields without making the flow too heavy.
2. Add profile photo and previous work photo classification.
3. Add ID document/certification upload classification and required-upload blocking where applicable.
4. Persist per-category experience, skill level, approval status, and rates.
5. Add references capture.
6. Add admin more-info request state/action.
7. Add category-specific approval UI/actions.
8. Make KYC/verification policy explicit for matching and full-detail unlock.
9. Update approval WhatsApp copy to selected-job credit wording.

## Risks

| Risk | Impact |
|---|---|
| Overloading WhatsApp onboarding | Lower completion rates if too many fields are required upfront |
| Evidence uploads before application creation | Current backfill pattern is safe but must remain idempotent |
| No more-info status | Admin may need to reject applications that should be remediable |
| No category-level approval | Providers may be over-eligible for categories they listed but admin has not reviewed |
| Current approval language charges on accepted lead | Must be updated before shortlist launch to avoid provider confusion |

## OpenBrain note

Provider onboarding gap assessment completed. Current onboarding is a solid WhatsApp-first application flow with admin approve/reject, evidence upload, structured service areas, portal identity creation, and ledger-based starter credits. Required shortlist readiness work is structured data depth: rates, references, profile photo, classified documents/photos, per-category approval, more-info requests, and explicit KYC/trust-level policy. Reuse current `ProviderApplication`, `Provider`, `Attachment`, `TechnicianServiceArea`, wallet ledger, and admin application actions.
