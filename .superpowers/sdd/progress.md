# SDD progress ledger — Provider Quality Gate v2

Plan: docs/superpowers/plans/2026-07-04-provider-quality-gate-v2.md
Branch: feat/provider-quality-gate-v2
Base: 628ebed7702f8d81e8dee083df7d930c9fb5dbc9

## Tasks
- [x] Task 0.1: complete (commit faaafb55, review clean)
- [x] Task 0.2: complete (commit a4835583, review clean)
- [x] Task 0.3: complete (commit d368d411, review clean)
- [x] Task 1.1: complete (commits 825d0d3d,3378fa3e, review clean after fix)
- [x] Task 1.2: complete (commits 13333296,706e3b1c, review clean after fix)
- [x] Task 1.3: complete (commits c230800e,19458868, review clean after fix)
- [x] Task 1.4: complete (commits 6dbd9f9e,4169bbea, review clean after fix)
- [x] Task 1.5: complete (commits 1b88156d,53d4f8c4, review clean after fix)
- [x] Task 1.6: complete (commits 1c49f6d7,e5e1538b, review clean after fix)
- [x] Task 1.7: complete (commits ad7f539b,47b8c4ba, review clean after fix)
- [x] Task 1.8: complete (commits a4181049,95528c39, review clean after hardening)
- [x] Task 2.1: complete (commits f7d8926d,c8a1f82c, review clean after fix)
- [x] Task 2.2: complete (commits 444e89fb,29e6d439, review clean after test hardening)
- [x] Task 2.3: complete (commit 5b386aeb, review clean, test-only)
- [x] Task 2.4: complete (commits 2080f2b0,43c00311, review clean after test add)
- [x] Task 2.5: complete (commits 06c3eb16,14293e6d, review clean after fix)
- [ ] Task 2.6: webhook completion PASSED/FAILED
- [ ] Task 2.7: retire manual reg_verify when gate ON
- [ ] Task 2.8: Didit-unavailable handling
- [ ] Task 3.1: full suite + typecheck + lint
- [ ] Task 3.2: rollout runbook

## Minor findings roll-up (for final review)


Task 0.1: complete (commits 628ebed7..faaafb55, review clean)
Task 0.2: complete (commits faaafb55..a4835583, review clean)
Task 0.3: complete (commits a4835583..d368d411, review clean)
  Minor (final-review): relation-block alignment inconsistent in provider_identity_verifications (cosmetic, non-blocking)
Task 1.1: complete (commits d368d411..3378fa3e, review clean after 1 fix — OFF-path now asserts create reached)
Task 1.2: complete (commits 3378fa3e..706e3b1c, review clean after 1 fix — as-any TODO + explicit OFF default)
  Note: tests added to existing provider-registration-pwa-flow.test.ts (controller-authorized; brief fixtures-module path intentionally not used) — NOT a defect for final review
Task 1.3: complete (commits 706e3b1c..19458868, review clean after 1 fix — skip-shortfall assert, pinned advance step, skip-hint suppressed when gate ON)
  Minor (final-review): promptEvidenceAfterBio gate param is optional — a future in-flow caller could trigger a 2nd async flag read (no double-read today)
Task 1.4: complete (commits 19458868..4169bbea, review clean after 1 fix — evidenceNote preserved on high-risk skip, cert upload+skip routing tested)
Task 1.5: complete (commits 4169bbea..53d4f8c4, review clean after 1 fix — remove-by-index, a11y, enabled-state test). DECISION: EvidenceUploader takes injected uploadFile prop (profile-photo route is session-authed, unusable on token-gated /provider/signup)
Task 1.6: complete (commits 53d4f8c4..e5e1538b, review clean after 1 fix). Added: uploadProviderEvidencePhoto storage helper + token-authed route app/api/provider/signup/evidence-photo
Task 1.7: complete (commits e5e1538b..47b8c4ba, review clean after 1 fix). Added session-authed route app/api/provider/registration/evidence-photo + pure evidenceStepComplete helper. Wizard component render test deferred to Playwright (no jsdom).
Task 1.8: complete (commits 47b8c4ba..95528c39, review clean after hardening create-payload inspection)

=== PHASE 1 COMPLETE (free gates: evidence>=3 + high-risk cert across WhatsApp + both PWA surfaces, flag-gated, regression-guarded) ===
Task 2.1: complete (commits 95528c39..c8a1f82c, review clean after 1 fix — threaded providerApplicationDraftId through non-ForSubject vendor resolver). NOTE: allowlist model has no draft column, so allowlist OR-query intentionally not extended.
Task 2.2: complete (commits c8a1f82c..29e6d439, review clean). New lib/identity-verification/application-link.ts: issueProviderApplicationVerificationLink (providerId:null, draft-anchored, reuse non-terminal). Returns verificationUrl string|null (matches existing sibling).
Task 2.3: complete (commit 29e6d439..5b386aeb, review clean). Consent->session-create chain was ALREADY null-provider tolerant; commit is a regression-lock test only.
  Minor (final-review): consent-null-provider test has declared-but-unasserted db spies; dynamic per-test import is style-fragile.
Task 2.4: complete (commits 5b386aeb..43c00311, review clean). Gate-ON handlePending persists ProviderApplicationDraft w/ submitPayload JSON (version,channel:WHATSAPP,syncProviderArgs,submitApplicationArgs[providerId:null placeholder],replayInputs,canonicalSkills,categorySlugs) + issues WHATSAPP link + CTA + reg_awaiting_kyc; creates NO provider/application. Added submitPayload Json? column (migration 20260704010000). handleAwaitingKyc finds draft by {phone, submittedApplicationId:null}.
  REPLAY CONTRACT (for 2.6): 2.6 must call its OWN syncProviderRecord (skipEnrichment:true) for providerId, NOT the null placeholder.
  Deferred to 2.8: draft dedupe find-then-write race (durable fix = partial unique index on phone WHERE submitted_application_id IS NULL).
Task 2.5: complete (commits 43c00311..14293e6d, review clean after 1 fix — real route-handler test + Prisma.InputJsonValue casts). PWA submitPayload channels: PWA_SELF_SERVE (Flow A, written onto existing draft) + PWA_RESUME (Flow B, upserted draft), both version:1. Resume tokens NOT consumed on gate-ON. Status route GET /api/provider/identity/application-status (hashed token, {status,decision} only, 400 missing/404 unknown).
