# Provider Approval Cohort Automatch Fix - 2026-05-01

## Context

An approved provider application for Fanie Masemola was marked as an internal test cohort application, but the linked provider record did not retain `isTestUser` or `cohortName`. The open Ruimsig handyman request was also an internal test request. Matching separates test and live cohorts before eligibility filtering, so Fanie was excluded from the raw candidate set and no lead or assignment hold was created.

## Decision

Provider record sync must preserve cohort flags from the provider application instead of deriving them only from the phone number. This keeps approved test providers eligible for test jobs while preserving the live/test boundary for production customers.

## Implementation

- `syncProviderRecord` now accepts explicit `isTestUser` and `cohortName` values and writes them to the provider record.
- Application reconciliation selects cohort fields and repairs approved provider rows that lost test-cohort flags.
- Manual admin approval now runs `checkJobsForNewProviderAvailability`, matching the cron auto-approval path so open jobs are retried after approval.
- The WhatsApp registration flow passes the cohort captured during application submission into the initial provider sync.

## Validation

Focused unit coverage was added in `__tests__/lib/provider-record.test.ts` for cohort preservation and approved-application repair.
