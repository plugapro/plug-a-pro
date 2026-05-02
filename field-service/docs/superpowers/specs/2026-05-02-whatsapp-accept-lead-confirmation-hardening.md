# WhatsApp Accept Lead Confirmation Hardening

**Date:** 2026-05-02
**Project:** Plug A Pro — field-service
**Status:** Follow-up hardening implemented

This note records the review follow-up for provider WhatsApp lead acceptance confirmations.

## Root Cause

`notifyPostMatchAcceptance` sent the customer notification before the provider confirmation. Customer-side WhatsApp failures could prevent the provider confirmation from being attempted. The first fix isolated customer failures, but review found two remaining gaps:

- Provider primary confirmation send failures could still throw out of `notifyPostMatchAcceptance`.
- The fallback WhatsApp confirmation omitted the starter/purchased credit breakdown and did not consistently try to attach the accepted job link.

## Implementation Decision

Provider confirmation is now treated as its own required side effect:

- Customer notification failure is non-fatal.
- Provider wallet balance lookup failure is non-fatal and falls back to a zeroed balance rather than blocking confirmation.
- Provider primary confirmation failure is caught and logged, and `providerNotified: false` is returned.
- WhatsApp accept handlers use one shared fallback confirmation helper when `notificationSent` is false.
- The fallback helper reloads the current provider wallet balance, includes starter/onboarding and purchased credit balances, and attempts to send the signed job handover URL as a CTA.
- `acceptAssignmentOffer` returns the post-accept `creditTransactionId`, `currentCreditBalance`, and `alreadyUnlocked` fields so wrappers and fallback messaging receive the actual transaction outcome.

## Verification

Focused tests cover:

- Customer notification failure does not block provider confirmation.
- Provider confirmation failure is captured without throwing.
- Matching wrapper preserves notification state.
- Assignment acceptance returns credit result fields needed by downstream confirmation handling.
