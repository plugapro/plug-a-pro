# Provider Onboarding ↔ Data Model Mapping

This document is the source of truth for which provider data fields are
collected during WhatsApp onboarding, which are derived elsewhere, and which
are intentionally not collected. The completeness validator at
`lib/provider-onboarding-completeness.ts` enforces these decisions in code.

Adding a new required field? Update the table below, the validator, and the
schema if needed. **Schema changes must be additive only** (per repo
CLAUDE.md house rules).

## Field-by-field mapping

| Field | Model | Required | Used for matching | Shown to customer | Collected during WhatsApp onboarding? | Onboarding step | Gap / Action |
|---|---|---|---|---|---|---|---|
| `name` | Provider, ProviderApplication | yes | no | yes | yes | `reg_collect_name` | OK |
| `phone` | Provider, ProviderApplication | yes | yes (identity) | yes | yes (E.164 from WhatsApp sender) | implicit | OK |
| `email` | Provider, ProviderApplication | optional | no | no | yes | `reg_collect_email` | OK |
| `idNumber` | ProviderApplication | required for approval | no | no (POPIA-protected) | yes | `reg_collect_id` | OK |
| `skills` | Provider, ProviderApplication | yes | yes | yes | yes | `reg_collect_skills` + `reg_collect_skills_more` | OK |
| `serviceAreas` | Provider, ProviderApplication | yes | yes | yes (suburb/city/province only) | yes | `reg_collect_area` → `reg_collect_suburb_*` | OK |
| `experience` | Provider, ProviderApplication | recommended | no | yes | yes | `reg_collect_experience` | OK |
| `availability` | Provider, ProviderApplication | yes | yes | indirect | yes | `reg_collect_availability` (Mon–Sun buttons) | OK |
| `callOutFee` (labour, excluding materials) | ProviderApplication, ProviderRate | yes for customer display | yes (sort/filter by budget) | yes | yes | `reg_collect_rates` (Phase 1 — improved copy) | OK after Phase 4 copy update |
| `hourlyRate` | ProviderApplication, ProviderRate | optional | no (yet) | no (yet) | no | — | Future enhancement (4b) |
| `rateNegotiable` | ProviderApplication, ProviderRate | optional | no | yes | yes | `reg_collect_rates` | OK |
| `quoteAfterInspection` | ProviderApplication | optional | no (yet) | no (yet) | no | — | Future enhancement (4b) |
| `emergencyAvailable` | ProviderApplication | optional | yes (post-MVP) | no | no | — | Defaults to false; future flag-driven step |
| `evidenceFileUrls` | ProviderApplication | optional | no | no (admin-only) | yes | `reg_collect_evidence` (multi-file batch) | OK after Phase 3 debounce |
| `evidenceNote` | ProviderApplication | optional | no | no | yes | `reg_collect_evidence` | OK |
| `verified` | Provider | system-set | yes | yes (verification badge) | no (set by admin on approval) | — | OK |
| `kycStatus` | Provider | system-set | yes | indirect | no (set by admin) | — | OK |
| `avatarUrl` (profile photo) | Provider | recommended | no | yes | **YES (Phase 4b)** | `reg_collect_profile_photo` (between `reg_collect_rates` and `reg_collect_evidence`) | OK after Phase 4b. Persisted as Attachment with `label: 'provider_profile_photo'`, linked to ProviderApplication on submit, URL copied to `Provider.avatarUrl` in the same transaction so customer shortlist cards show it immediately. Skip is always allowed. |
| `bio` | Provider | optional | no | yes | no | — | Future enhancement (4b) |
| `averageRating`, `completedJobsCount`, `reliabilityScore` | Provider | system-derived | yes | yes (when present) | no | — | OK — derived from job activity |

## Decision summary

- The current onboarding flow collects **every field that is required for
  matching** (skills, serviceAreas, availability) and **every field required
  for customer-display selection** (name, experience, callOutFee, rateNegotiable).
- The `callOutFee` field is the canonical "labour rate excluding materials"
  per Phase 4. The WhatsApp prompt copy was updated in Phase 4 to make this
  explicit ("call-out fee for labour (excluding materials)").
- `avatarUrl` (profile photo) is now collected via the optional
  `reg_collect_profile_photo` step (Phase 4b). It's persisted as an
  `Attachment` with `label: 'provider_profile_photo'`, linked to the
  ProviderApplication on submit, and copied onto `Provider.avatarUrl`
  in the same transaction so the customer shortlist card has a photo
  immediately. The completeness validator keeps `avatarUrl` at the
  `recommended` severity (not blocking) because the step is skippable.
- All other fields either default safely, are derived from platform
  activity, or are admin-set on approval/review.

## Completeness contract

`lib/provider-onboarding-completeness.ts#evaluateProviderProfileCompleteness`
returns:

```ts
{
  ok: boolean,                  // every requirement met
  canSubmit: boolean,           // no block_submit fields missing
  canApprove: boolean,          // no block_submit OR block_approve fields missing
  canShowToCustomers: boolean,  // no block_submit OR block_approve OR block_customer_display fields missing
  missing: Array<{ field, reason, group, severity }>,
}
```

Severity ladder (most strict first):

1. `block_submit` — provider can't submit application (name, phone, skills, serviceAreas, availability)
2. `block_approve` — provider can submit but admin can't approve (idNumber)
3. `block_customer_display` — admin can approve but customer shortlist excludes them (callOutFee, experience)
4. `recommended` — soft (avatarUrl)

## Phase 4b status

1. ✅ `reg_collect_profile_photo` step shipped between `reg_collect_rates` and `reg_collect_evidence`. Single-image upload, persisted as `Attachment(label: 'provider_profile_photo')`, linked to ProviderApplication on submit, URL copied onto `Provider.avatarUrl` in the same transaction so the customer shortlist card displays it immediately. Skip is always allowed (button + free-text fallback).

## Future enhancements (not yet scheduled)

1. Optional second rate field for hourly billing if Plug A Pro decides to expose hourly rates separately on the customer card.
2. Consider whether `bio` should be collected during onboarding for richer customer-card content.
3. Surface the completeness validator output on the admin review screen so reviewers see exactly what's missing before approving.
