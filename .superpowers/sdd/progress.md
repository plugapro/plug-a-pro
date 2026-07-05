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
- [x] Task 2.6: complete (core ad26b024,c7cc3ede + PWA replay f52819b6, all reviewed clean)
- [x] Task 2.7: complete (commit 1d542116, review clean)
- [x] Task 2.8: complete (commits 81fcd193,1d8e9410, review clean after fix)
- [x] Task 3.1: complete (commits 496edc8e,bf3d7374, review clean)
- [x] Task 3.2: complete (commit dcbe3701, docs-only)

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
Task 2.6 (core): reviewed clean (commits 14293e6d..c7cc3ede). WHATSAPP PASSED->PENDING replay, FAILED>=2->MORE_INFO+[quality-gate] note, idempotent, safeProviderStatusReason strips markers, webhook wired (draft-anchored only, try/catch). PWA_SELF_SERVE/PWA_RESUME replay = throwing TODO -> follow-up 2.6b.
  Minor (final-review): providerCategory optional-chain untested; notes written as separate update not atomic w/ create.
Task 2.6b (PWA replay): reviewed clean (commit c7cc3ede..f52819b6). Both PWA_SELF_SERVE + PWA_RESUME create PENDING app via submitProviderApplication, linked + idempotent. Full suite 5063 pass.
  Minor (final-review): PWA_SELF_SERVE skips syncProviderSkills (defensible); hourlyRate absent from Flow A payload -> null+TODO.
=== TASK 2.6 FULLY COMPLETE (create-on-PASS webhook completion, all 3 channels) ===
Task 2.7: complete (commit f52819b6..1d542116, review clean). Gate ON: handleCollectName + name_use_wa + migrated-email route to reg_collect_skills_more (skip manual reg_collect_id/reg_verify_*), no verification-choice prompt; gate OFF unchanged. VERIFIED reviewer name-loss concern is a non-issue: ctx.data.name already persisted (read at line 688) + nextData shallow-merges.
  Minor (final-review): name_use_wa gate-ON test lacks explicit skills-prompt sendText assertion.
Task 2.8: complete (commits 1d542116..1d8e9410, review clean). All 3 gate-ON launch sites catch issuer throws/null-URL -> friendly outcome, draft retained, no application, no manual fallback. WhatsApp already caught (2.4); both PWA sites got new guards.
Task 2.7 fallout: registration-name-shortcut.test.ts blanket isEnabled->true enabled the quality gate; fixed by pinning quality gate OFF (commit 33a91ae0). NOTE: draft-race unique index deferred to rollout runbook (3.2), not a code migration.
=== PHASE 2 COMPLETE ===
Task 3.1: complete (commits 1d8e9410..bf3d7374, review clean). FULL SUITE: 5077 passed / 0 failed / 1 skipped (508 files). tsc clean, lint clean. Smoke coverage added for /provider/register + /provider/signup (gate OFF). No production regression, no pre-existing flakes manifested.
Task 3.2: complete (commit dcbe3701, docs-only rollout runbook).

=== ALL 20 TASKS COMPLETE (Phase 0+1+2+3) === proceeding to final whole-branch review.
FINAL WHOLE-BRANCH REVIEW (opus): READY TO MERGE. All 6 cross-cutting risks passed (submitPayload contract consistent; gate-OFF invariant holds; idempotency double-guarded; allowlist bypass scoped; ops-note stripped; linking never strands). 1 Important NEW: PWA 2nd-failure path threw/stranded applicant -> FIXED (commit 56345eec: createPwaApplicationInline MORE_INFO + channel-correct retry + tx TODO). 36 tests pass, tsc clean.
Open follow-ups (non-blocking, tracked): hourlyRate null on PWA_SELF_SERVE replay; PWA_SELF_SERVE skips syncProviderSkills enrichment (confirm before flipping flag for PWA traffic); draft-race partial-unique-index (in rollout runbook); cosmetic minors.
FINISHED: pushed feat/provider-quality-gate-v2, opened PR #163 (https://github.com/plugapro/plug-a-pro/pull/163). Worktree preserved (Option 2). Flag OFF; not merged/deployed.
CODEX AUTO-REVIEW FIXES (post-PR): 4 Codex findings + 2 human-review follow-ups fixed. b2cfe49b (P1 validation guards x3 paths + completion re-check), c705171b (P1 webhook retryability + draft-link dedup + hourlyRate replay), 37045839 (log draft-link failures). Full suite 5102->pass, tsc clean. NOTE follow-up: PWA_SELF_SERVE hourlyRate stays null (self-serve draft input has no rate field; matches gate-OFF, no regression).
CODEX ROUND 2 (4 more findings, 2 P1): b046e546 (WhatsApp text-add evidence gate + web-resume partial-evidence re-prompt), d4d8818b (completion: conflict-link kills retry-loop, evidence defense-in-depth never PENDING-under-bar, providerRate replay WhatsApp+PWA_SELF_SERVE), 492accd4 (as-any TODO). Review clean. certificationRef confirmed NOT a persisted column (gate-check-only, matches gate-OFF). Full suite 5118 pass. Follow-ups: PWA_RESUME has no callOutFee field (rate rows not replayed for that channel); PWA_SELF_SERVE hourlyRate null.
CODEX ROUND 3 (4 findings, 1 P1): 80e5eb0a (P1 manual-review verdict->MORE_INFO no stranding; PWA server-side evidence/cert gate before KYC; test-cohort preserved on deferred completion; re-nudge selector includes draft-anchored rows) + 7e840d48 (Flow B gate rejection matches canonical QUALITY_GATE_* error + test + cohort comment). Review clean after 1 fix. Full suite 5130 pass.
DECISION: stopping reactive Codex loop after 3 rounds (P1 count 3->2->1->0 remaining). Recommendation: create-on-PASS completion reimplements the canonical creator (createApplicationInline/PWA inline) -> refactor to share the canonical creation logic before flipping the flag, to end this divergence bug class. Human eng review recommended.
REFACTOR COMPLETE (user-approved): 4d681e9a + ac2d37fe + 6e1af550 — single row-creator (submitProviderApplication w/ statusOverride/onConflict:link/initialNotes opts), shared finalizeWhatsappProviderSubmission used by gate-OFF handlePending AND completion, inline creators DELETED (grep-proof). Opus review: Approved, 0 Critical/Important, gate-OFF byte-equivalent. Merged origin/main (incl #166 normalize fix) 24cd3f94; suite 5141 pass. Runbook updated to Didit-GA reality.
