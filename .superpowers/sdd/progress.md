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
- [ ] Task 1.6: Flow B evidence+cert sections
- [ ] Task 1.7: Flow A wizard uploader+cert
- [ ] Task 1.8: flag-OFF regression guard
- [ ] Task 2.1: allowlist bypass app-stage
- [ ] Task 2.2: draft-anchored link issuer
- [ ] Task 2.3: consent null-provider tolerance
- [ ] Task 2.4: WhatsApp draft+Didit launch
- [ ] Task 2.5: PWA draft+Didit launch+status
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
