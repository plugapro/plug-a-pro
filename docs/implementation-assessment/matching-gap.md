# Matching Engine Gap Assessment

## Current matching algorithm

Current matching is explainable sequential assignment, not customer shortlist selection.

Primary files:

- `field-service/lib/matching/service.ts`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/matching/orchestrator.ts`
- `field-service/lib/matching/config.ts`

Current process:

1. `createJobRequest` creates a `JobRequest` with `status = OPEN`.
2. Post-commit orchestration calls `orchestrateMatch`.
3. `runAssignmentForJobRequest` calls `rankCandidatesForJobRequest`.
4. Providers are filtered by:
   - `Provider.active`
   - `Provider.verified`
   - `Provider.status = ACTIVE`
   - `Provider.availableNow`
   - category/skill match
   - structured service area/radius/legacy fallback
   - certifications/equipment/vehicle rules
   - schedule/availability/commitments
   - test cohort compatibility
5. Eligible providers receive score breakdowns for skill, schedule, travel efficiency, reliability, customer preference, and margin efficiency.
6. `DispatchDecision` stores ranking/filter summaries.
7. `MatchAttempt` stores each ranked/filtered provider attempt.
8. In auto mode, one top-ranked provider gets an active `AssignmentHold` and `Lead`.
9. If the provider declines or expires, `offerNextRankedCandidate` offers the next ranked candidate.

## Current lead invite model

Current lead invite anchor: `Lead`.

Relevant fields:

```text
jobRequestId
providerId
dispatchDecisionId
matchAttemptId
assignmentHoldId
status
sentAt
respondedAt
expiresAt
reminderSentAt
```

Step 3 added future shortlist fields such as `matchScore`, `rankingPosition`, `customerSelectedAt`, and `providerAcceptedAt`.

Current statuses:

```text
SENT
VIEWED
ACCEPTED
DECLINED
EXPIRED
```

There is no separate provider response object in the current production flow, but step 3 added `ProviderLeadResponse`.

## Current job assignment flow

Current assignment happens when the provider accepts the active offer:

1. Provider opens lead preview.
2. Provider accepts lead through PWA or WhatsApp.
3. `acceptAssignmentOffer` runs a Prisma transaction.
4. Transaction verifies provider eligibility, active hold, expiry, and no other match.
5. `unlockLeadForProviderInTransaction` creates `LeadUnlock` and debits 1 credit.
6. `Lead.status` becomes `ACCEPTED`.
7. `AssignmentHold.status` becomes `ACCEPTED`.
8. `Match` is created.
9. `JobRequest.status` becomes `MATCHED`.
10. Other pending leads/holds for the request are expired/released.
11. Optional auto booking artifacts are created for categories with accepted amount policy.

## Current credit deduction timing

Credits are deducted during provider acceptance of the sequential lead offer. This is earlier than the Qualified Shortlist Model.

Current debit path:

- `acceptAssignmentOffer`
- `unlockLeadForProviderInTransaction`
- `debitCreditsForLeadUnlockInTransaction`
- `WalletLedgerEntry.entryType = LEAD_UNLOCK_DEBIT`
- `LeadUnlock` created with `creditsCharged = 1`

The transaction is ledger-first and atomic with match creation, but the trigger point is wrong for the target model.

## Current expiry handling

Expiry is handled through `AssignmentHold.expiresAt`, `Lead.expiresAt`, and `processPendingAssignmentWorkflows`.

Behavior:

- Active holds expire after configured offer TTL.
- Expired leads/holds are marked `EXPIRED`.
- Provider may receive `interactive:lead_expired`.
- Repeated offer timeouts can pause provider availability.
- Next ranked provider can be offered.
- No credit is deducted on expiry.

## Current WhatsApp payloads

Current provider opportunity messages still use lead/accept language:

- `job_offer` template in `messaging-templates.ts`
- `interactive:new_lead_actions`
- `Accept Lead`
- `Decline`
- `View Lead`
- `interactive:lead_expired`

Current copy says accepting uses 1 credit and unlocks details. This must change for the shortlist model: preview and interest should be free; credit applies only after customer selection and provider final acceptance.

## Gaps against Qualified Shortlist Model

| Target | Current state | Gap |
|---|---|---|
| Top matched providers receive safe preview | Ranking can identify top providers | Auto mode offers one active provider at a time |
| Provider responds interested/not interested | Accept/decline only | Need interested response with fee/arrival/rate |
| Provider response is free | Accept currently charges | Need no charge for preview/interest |
| Customer shortlist | No active shortlist view/generation | Step 3 tables exist but need logic/UI |
| Customer selection before provider final acceptance | Provider acceptance creates match first | Need selected-provider confirmation state |
| Credit charged after selected provider accepts | Credit charged on lead acceptance | Need move debit trigger |
| Full details unlock after selected acceptance | Unlock exists after current accept | Reuse unlock but change trigger |
| Auditable shortlist decisions | `DispatchDecision` and `MatchAttempt` exist | Need shortlist publication and selection audit |

## Reuse recommendations

1. Reuse `rankCandidatesForJobRequest` for provider scoring.
2. Reuse `DispatchDecision` and `MatchAttempt` for auditable matching decisions.
3. Reuse `Lead` as the lead invite anchor.
4. Use `ProviderLeadResponse` from step 3 for interested/not-interested details.
5. Use `ProviderShortlist` and `ProviderShortlistItem` from step 3 for customer comparison.
6. Reuse `ProviderLeadDetail` and signed lead tokens for privacy-safe preview.
7. Reuse `ProviderWallet` and `WalletLedgerEntry` for final acceptance debit.
8. Keep sequential assignment compatibility during migration.

## Required changes

1. Add top-N shortlist dispatch mode that sends safe opportunities to several providers.
2. Add provider response capture without credit debit.
3. Create shortlist from interested responses.
4. Add customer selection flow.
5. Add selected-provider final acceptance flow.
6. Move credit debit and `LeadUnlock` creation to selected-provider final acceptance.
7. Update WhatsApp copy/buttons from `Accept Lead` to `Interested`, `Not interested`, and later `Accept job`.
8. Ensure old sequential leads are either supported or cut over safely by feature flag.

## Risks

| Risk | Impact |
|---|---|
| Changing credit timing | Ledger and support reports must distinguish historical lead unlocks from selected-job acceptances |
| Active sequential leads during cutover | Providers could see old accept behavior while customers expect shortlist |
| Top-N invitations | Provider capacity/availability holds must avoid over-reservation |
| Customer shortlist delay | Customer messaging must explain provider response waiting period |
| Response expiry | Expired interested responses must not be selectable |

## OpenBrain note

Matching gap assessment completed. Current matching is explainable and auditable but sequential: one provider receives an active offer and pays 1 credit on acceptance. Qualified Shortlist implementation should reuse ranking, dispatch decisions, match attempts, lead tokens, and wallet ledger, but change the sequence to top-N safe opportunity previews, free provider interest responses, customer shortlist selection, then selected-provider final acceptance with credit debit and detail unlock.
