# Provider application triage sweep — design

**Status**: spec, approved in session 2026-07-01, ready for implementation plan
**Scope**: one repeatable sweep script + one new Meta template. No admin UI.
**Related**: [[project-quality-uplift-wave1]], KYC grace-flag retirement criteria (PR #149), high-risk gate (`lib/service-category-policy.ts`)

## 1. Goal

Clear the provider application queue (29 rows as of 2026-07-01: 20 PENDING + 9 MORE_INFO_REQUIRED) with four triage rules, and close the KYC-nudge coverage gap for active-but-unverified providers (105 of 112 active). Repeatable: the queue refills at ~20 applications/month.

## 2. Ground truth (queried 2026-07-01)

- Pilot footprint: 8 active suburbs (honeydew, randpark_ridge, constantia_kloof, florida, bromhof, discovery, helderkruin, little_falls) per `lib/launch/west-rand-pilot.ts` / `lib/ops-agents/pilot-area.ts`.
- Bucket sizes: rule 1 = 4 in-pilot no-ID; rule 2 = 10 in-pilot ID-captured (1 plumbing-only, 1 verification-row-no-idNumber edge); rule 3 = 15 out-of-pilot; rule 4 = 105 active KYC-unverified, of which ~74 already covered by the live KYC-drive cron (48 sends in last 7 days).
- Every queued application includes plumbing (`high_risk` in category policy). None has evidence artifacts beyond one evidence note.
- Zero historical `KYC_NOT_VERIFIED` match exclusions (grace flag ON since 2026-06-14) — "you missed N leads" would be false; rule 4 uses forward-looking framing instead.
- One probable duplicate: an applicant matching an existing active provider (Vigilance). Duplicate guard is mandatory.
- Template status at Meta: `provider_registration_continue`, `provider_high_risk_cert_nudge`, `provider_quality_multi_nudge`, `provider_verification_resume_*` APPROVED. `provider_kyc_nudge` sends successfully in prod (171 sends; not visible in the WABA template listing — see Open Observation §8). No waitlist/area template exists.

## 3. Decision table (priority order, evaluated at run time)

| # | Condition | Status action | Message | Extra |
|---|---|---|---|---|
| 0 | Applicant phone matches an active `Provider.phone` | Skip + report | none | Manual-review list (duplicate applications) |
| 3 | No `serviceAreas` overlap with pilot suburbs (via `isPilotArea` name-normalised match) | PENDING stays; if no ID → MORE_INFO_REQUIRED | `provider_area_waitlist` (new) | Insert `ServiceAreaWaitlist` row (`phone`+`city` unique; `source='triage-sweep'`) |
| 1 | In-pilot AND no ID (`idNumber` empty AND no `provider_identity_verifications` row) | → MORE_INFO_REQUIRED | `provider_registration_continue` | `notes` marker appended |
| 2 | In-pilot AND ID captured AND ≥1 non-high-risk skill | → APPROVED; `Provider.skills` = selected minus high-risk (per `service-category-policy.ts`) | `provider_high_risk_cert_nudge` | High-risk skills re-added on cert review |
| 2b | In-pilot AND ID captured AND high-risk-only skills | → MORE_INFO_REQUIRED | `provider_high_risk_cert_nudge` | Nothing approvable yet |
| 4 | Active provider, `kycStatus != 'VERIFIED'` | no status change | `provider_kyc_nudge` via existing `sendProviderKycNudge` | Inherits KYC-drive 7-day spacing + 3-cap dedup |

"ID captured" = `idNumber` non-empty OR an identity-verification row exists (covers the Bernard edge).

## 4. New Meta template

`provider_area_waitlist` — UTILITY, en_ZA, no button:

> Hi {{1}}, thanks for applying to Plug A Pro. We're not live in {{2}} yet — your application is saved and you're on the launch list. We'll message you the moment we start rolling out in your area. No need to re-apply.

`{{1}}` first name; `{{2}}` area label (e.g. "Midrand", "the Western Cape" — derived from the applicant's first serviceArea, humanised). Added to `lib/messaging-templates.ts` and `scripts/register-whatsapp-templates.mjs` in the same PR.

## 5. Script

`field-service/scripts/application-triage-sweep.ts`

**Modes**
- `--dry-run` (default): classify everything, print per-applicant table (name, phone tail `…1234`, rule, status change, template). Zero writes, zero sends.
- `--execute`: apply status changes + send messages, 300ms spacing between sends.
- `--rule=1|2|3|4`: single-rule execution. Rule 3 checks the waitlist template's Meta approval via the Graph API status endpoint and skips-with-warning if not APPROVED.

**Safety rails**
1. Idempotency: `notes` marker `[triage-sweep YYYY-MM-DD rule-N]` per processed application; marked rows are skipped on re-run.
2. Duplicate guard runs before all rules.
3. Message dedup: same template to same phone within 7 days → skip (message_events lookup). Rule 4 delegates to `sendProviderKycNudge` (existing spacing/caps).
4. Audit: every status mutation writes an `AuditLog` row (`actorRole='SYSTEM'`, `action='application.triage_sweep'`, before/after). Documented exception to the crudAction house rule (no admin session in scripts) — same pattern as ops-agents writers.
5. PII: stdout shows phone tails only.
6. Skills edits only remove high-risk entries; never add or rename.

## 6. Execution sequence

1. PR: template registration + script + tests → review → merge.
2. Submit `provider_area_waitlist` to Meta (register script run).
3. `--dry-run` against prod → user reviews classification table → explicit approval.
4. `--execute --rule=1`, `--rule=2`, `--rule=4` (same day — templates already approved).
5. On Meta approval (24-72h): `--execute --rule=3`.
6. OpenBrain log with per-rule counts.

## 7. Tests

`__tests__/scripts/application-triage-sweep.test.ts` — real-module import (per the Tier 1 funnel review lesson), mocked at `lib/whatsapp` / `db` seams. Cases: each rule happy-path, duplicate guard, plumbing-only branch, verification-row-no-idNumber edge, idempotent re-run skip, waitlist-template-not-approved skip, dry-run performs zero writes/sends.

## 8. Open observation (not blocking)

`provider_kyc_nudge` does not appear in the WABA `104200042667877` template listing yet sends succeed (171 sends, latest 2026-07-01). Likely registered under a second WABA/business portfolio tied to the same phone number. Worth resolving when convenient; does not affect this sweep because sends demonstrably work.

## 9. Out of scope

- Admin UI bulk-triage buttons
- Auto-decline of stale MORE_INFO_REQUIRED rows
- KYC grace-flag retirement (separate decision, PR #149)
- Waitlist rollout notifications when new areas launch
- "You missed N leads" messaging (revisit after grace-flag retirement produces real exclusion data)
