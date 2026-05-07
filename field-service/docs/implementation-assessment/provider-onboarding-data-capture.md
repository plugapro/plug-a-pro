# Provider Onboarding — Data Capture Upgrade

## Summary of changes

Four known gaps (G1–G4) from the Step 04 gap analysis were addressed. G3 was
already closed by existing code; the remaining three received targeted fixes.
All changes are additive — no schema drops, no breaking renames.

---

## G3 fix: Manual approval promo credits

**Finding:** Already implemented.

`awardMobileVerifiedPromoCreditsInTransaction` is called at
`app/(admin)/admin/applications/page.tsx:297` inside the `crudAction`
transaction that flips the application status to `APPROVED`. Both the provider
record write and the promo credit award commit together or roll back together,
so no manual approval can succeed without issuing the `MOBILE_VERIFIED` award.

**Tests added** (`__tests__/lib/provider-promo-awards.test.ts`):

- `G3: awards MOBILE_VERIFIED credits via the manual admin approval call signature`
  — verifies the exact call shape (`referenceType: 'provider_application'`,
  `referenceId`, `createdBy: adminUserId`) used by the admin action awards
  credits correctly.
- `G3: is idempotent — second manual approval attempt does not double-award`
  — confirms `DUPLICATE` skip reason on retry, preserving the
  idempotency guarantee needed when admins re-submit the form.

---

## G4 fix: locationNodeIds validation

**Problem:** `ProviderProfileLike.serviceAreas` was the only field that could
satisfy the service-area completeness requirement.  Providers who complete
onboarding via the structured WhatsApp flow submit `locationNodeIds` (references
to `LocationNode` rows) rather than freetext `serviceAreas`.  A profile with
only `locationNodeIds` would therefore fail the block-submit completeness check
even though it carried valid coverage data.

**Changes** (`lib/provider-onboarding-completeness.ts`):

1. Added `locationNodeIds?: string[] | null` to `ProviderProfileLike` with a
   JSDoc comment explaining the OR relationship with `serviceAreas`.
2. Updated the `serviceAreas` field requirement's `satisfiedBy` predicate to
   accept either a non-empty `serviceAreas` array or a non-empty
   `locationNodeIds` array. The reason text was updated to reflect this.

**Tests added** (`__tests__/lib/provider-onboarding-completeness.test.ts`):

- `blocks submission when both serviceAreas and locationNodeIds are absent`
- `accepts locationNodeIds alone as sufficient for the service-area requirement`
- `accepts legacy serviceAreas alone when locationNodeIds is absent`
- `accepts when both serviceAreas and locationNodeIds are provided`

---

## G1: Auth gap — documented in code

**Problem:** Providers approved entirely via WhatsApp have no Supabase Auth
account at approval time.  The Worker Portal CTA URL in the approval WhatsApp
message is unreachable until an auth account is provisioned.

**Change** (`lib/provider-application-notifications.ts`):

Added a block comment at the top of the file (before the imports) describing:
- The gap: WhatsApp-only providers have no auth account at the point the
  approval notification is sent.
- The planned mitigation: send a Supabase OTP invite to the provider's phone
  in the same `crudAction` transaction that flips the application to `APPROVED`,
  immediately before this notification is dispatched.
- The interim behaviour: the Worker Portal link is decorative; providers can use
  WhatsApp commands (`reply "menu"`) to operate until the OTP invite is shipped.

No functional code was changed for G1.

---

## G2: POPIA — marked in schema

**Change** (`prisma/schema.prisma:353–354`):

The existing detailed POPIA comment on `ProviderApplication.idNumber` was
retained and supplemented with the explicit TODO marker requested:

```
// TODO(POPIA): idNumber stored plaintext — encrypt before GA (§26 special personal info)
```

No migration required — this is a comment-only change.

---

## Files changed

| File | Change |
|---|---|
| `lib/provider-onboarding-completeness.ts` | Added `locationNodeIds` to `ProviderProfileLike`; updated `serviceAreas` satisfiedBy predicate (G4) |
| `lib/provider-application-notifications.ts` | Added G1 auth-gap comment block (documentation only) |
| `prisma/schema.prisma` | Added `TODO(POPIA)` comment to `idNumber` field (G2) |
| `__tests__/lib/provider-onboarding-completeness.test.ts` | 4 new tests for G4 |
| `__tests__/lib/provider-promo-awards.test.ts` | 2 new tests for G3 (describe block) |

---

## Tests added

| Test file | Suite | Test description |
|---|---|---|
| `provider-onboarding-completeness.test.ts` | `evaluateProviderProfileCompleteness` | blocks submission when both serviceAreas and locationNodeIds are absent |
| `provider-onboarding-completeness.test.ts` | `evaluateProviderProfileCompleteness` | accepts locationNodeIds alone as sufficient for the service-area requirement |
| `provider-onboarding-completeness.test.ts` | `evaluateProviderProfileCompleteness` | accepts legacy serviceAreas alone when locationNodeIds is absent |
| `provider-onboarding-completeness.test.ts` | `evaluateProviderProfileCompleteness` | accepts when both serviceAreas and locationNodeIds are provided |
| `provider-promo-awards.test.ts` | `G3: manual admin approval calls awardMobileVerifiedPromoCreditsInTransaction` | awards MOBILE_VERIFIED credits via the manual admin approval call signature |
| `provider-promo-awards.test.ts` | `G3: manual admin approval calls awardMobileVerifiedPromoCreditsInTransaction` | is idempotent — second manual approval attempt does not double-award |

---

## Test results

```
Test Files  163 passed | 1 skipped (164)
     Tests  1731 passed | 4 todo (1735)
  Duration  10.49s
```

0 failures.

---

## Remaining gaps

| Gap | Status | Notes |
|---|---|---|
| G1 — Auth: WhatsApp-only providers have no Supabase account | Documented | OTP invite on approval is the planned fix; out of scope for this step |
| G2 — POPIA: idNumber plaintext | Marked | Encryption before GA required; out of scope for this step |
| G3 — Manual approval promo credits | Closed (pre-existing) | `awardMobileVerifiedPromoCreditsInTransaction` already called in the admin transaction; tests added |
| G4 — locationNodeIds completeness | Closed | `ProviderProfileLike` extended; completeness predicate updated; tests added |

---

## OpenBrain Note

Logged under project `PlugAPro`, domain `engineering`,
title `engineering — Step 05 provider onboarding data capture upgrade (2026-05-07)`.
