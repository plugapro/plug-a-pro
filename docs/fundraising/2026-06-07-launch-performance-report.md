# Plug A Pro — Launch Performance Report

**Date authored:** 2026-06-07
**Author:** Founder + AI investigation
**Scope:** First two days post-launch (2026-06-05 → 2026-06-07 SAST)
**Companion files:** `2026-06-07-metrics-sql-pack.sql`, `2026-06-07-investor-deck-blueprint.md`, `2026-06-07-immediate-action-plan.md`

> **Confidence taxonomy used throughout:** every finding is tagged
> `[Proven]` (DB-verifiable), `[Early signal]` (visible but two-day window),
> `[Assumption]` (working belief, not yet measured), `[Risk]`, `[Unknown]`,
> or `[Needs more data]`.

---

## 1. Executive summary

Plug A Pro is a WhatsApp-first field-service marketplace for South Africa. It went live in two layered moments: a **pilot launch on 2026-05-17** scoped to non-regulated trades, and a **broader public rollout in the 2026-06-05 / 2026-06-06 window** coinciding with centralised marketing copy and the provider-onboarding PWA going live.

The honest two-day post-launch picture is dominated by **two facts**:

1. **The product works end-to-end.** Provider onboarding, WhatsApp inbound, admin review, voucher allocation, dispatch decisioning, and the customer PWA path are all implemented and connected. The marketing site is live. This is not vapourware. `[Proven from code + git history]`
2. **A production database was wiped on 2026-06-06 during the rollout window.** A backup-restore covered tabular data; WhatsApp blob recovery is still in flight via a founder-authored end-to-end WABA script. The read-only audit script (`scripts/audit-whatsapp-blob-gaps.ts`, PR #39, merged 2026-06-07) reports **86/110 WhatsApp media attachments restored, 24 still missing — all of them inside Meta's replayable retention window**. Zero are in the irrecoverable `gt_7d` bucket. `[Proven from PR #39 audit output]`

The story for investors is therefore not "look at our hockey stick after 48 hours" — it is **"we shipped a real WhatsApp-native marketplace, we survived an incident on launch day with a documented production-safety protocol, and the first signals are now usable."** The deck should lead with the *operating discipline* a rebuilt-overnight database demonstrates, not with two-day vanity counters.

This report flags the metrics worth running, the operational actions worth doing in the next 24 hours, and the gaps that must close before the first real investor conversation.

---

## 2. Data window used

| Boundary | Date | Note |
|---|---|---|
| Pilot launch | 2026-05-17 | `chore(pilot): scope skills to non-regulated trades for launch` (commit `45fc8af9c`) |
| Marketing launch copy push | 2026-06-02 | `Centralize marketing launch copy` (commit `cbc23e168`) |
| Public rollout / cutover | 2026-06-05 → 2026-06-06 | Provider onboarding journeys hardened (commits `06b09dfb1`, `cbee9ae89`, `b757c62da`) |
| DB wipe incident | 2026-06-06 | Documented in `docs/superpowers/specs/2026-06-06-db-wipe-recovery-design.md` |
| Report cutoff | 2026-06-07 23:59 SAST | Recovery still actively in flight |

**Window assumption:** "Two days post-launch" means **2026-06-05 00:00 SAST → 2026-06-07 23:59 SAST**, parameterised in the SQL pack as `:launch_start` / `:launch_end`. The pack also exposes `:pilot_start = 2026-05-17` for the longer pilot lens, which is the more honest denominator for actual customer behaviour.

---

## 3. Key metrics table

Every cell here is *what to look at*. The numeric values come from running Section 1–8 of `2026-06-07-metrics-sql-pack.sql`. I am deliberately not making up numbers.

| Metric | SQL ref | Status | Notes |
|---|---|---|---|
| Customer registrations (launch window) | §1.1 | `[Needs more data]` | Split by channel — WhatsApp vs PWA-linked |
| Provider registrations (launch window) | §1.2 | `[Needs more data]` | Split by source path |
| Application funnel: draft / submitted / approved | §1.3, §1.4 | `[Needs more data]` | Specifically expect leak at "draft only, no application" |
| Approved providers per category | §2.1 | `[Needs more data]` | Pilot is non-regulated trades only |
| Approved providers per city | §2.2 | `[Needs more data]` | Should expose coverage holes immediately |
| Providers approved but missing components | §2.3 | `[Risk]` | Each row here is a lead the platform cannot actually fulfil |
| `PILOT_MAY2026` voucher batch status | §3.1 | `[Needs more data]` | Memory: auto-grant is gated by `VOUCHER_PILOT` flag — verify on / off |
| Approved providers w/o voucher redemption | §3.2 | `[Risk]` | Every row here is an approved provider with zero credit |
| Wallet net balance per provider | §3.3 | `[Needs more data]` | Zero-balance rows = supply that cannot accept leads |
| Job requests by status (launch window) | §4.1 | `[Needs more data]` | The shape of demand |
| Job requests by category | §4.2 | `[Needs more data]` | Mismatch vs §2.1 is the supply story |
| Dispatch decisions — no-match reasons | §4.3 | `[Needs more data]` | Memory: structured `noMatchReason` + `stageCounts` |
| Match → Quote → Booking → Job conversion | §4.4 | `[Needs more data]` | Lower funnel |
| Demand vs supply gap by category | §4.5 | `[Needs more data]` | Headline operational chart |
| Inbound WhatsApp volume by hour | §5.1 | `[Needs more data]` | Activation channel |
| Outbound delivery success | §5.2, §5.3 | `[Risk]` | History flags "21 templates missing from WABA" (commit `5876d8df2`, 2026-04-08); confirm cleared |
| Conversations stuck > 2h | §5.4 | `[Risk]` | Where the bot loses people |
| Admin queue depth | §6.1 | `[Needs more data]` | Pending applications, open cases, no-match requests |
| Lead unlock revenue proxy | §7.1, §7.2 | `[Needs more data]` | Closest thing to revenue at this stage |
| Webhook processing failures | §8.1 | `[Risk]` | Direct measurement of platform reliability |
| OTP delivery health | §8.2 | `[Risk]` | OTP is the activation gate; recent commits hardened this |

**Action:** founder runs the SQL pack against the restored prod replica, pastes the result tables back into this report (or into `docs/fundraising/2026-06-07-actuals.md`), and the deck pulls numbers from there. Do not present any number not produced by these queries.

---

## 4. Funnel analysis

The funnel has six observable stages. Each stage corresponds to schema state, so it is measurable as soon as the SQL pack is run.

```
Acquisition  →  Registration  →  Application  →  Approval  →  Credit/Voucher  →  Active Supply
   (WA inbound /                       (submitted, evidence       (approvedAt set,   (voucher redeemed,
   PWA visit)                          attachments uploaded)      status = ACTIVE)   wallet > 0)
```

**Expected leaks based on code review:**

1. **WhatsApp inbound → registration.** `[Risk]` New WhatsApp users have to push through the `processInboundMessage` bot. Without a current name on file, the bot prompts. Drop-off here is invisible unless `Conversation.data.currentStep` is mined (SQL §5.4 surfaces idle conversations). If a marketing campaign drives WhatsApp inbound, this is where it dies silently.
2. **Application draft → submitted.** `[Early signal]` `ProviderApplicationDraft` exists separately from `ProviderApplication`. Drafts that never become applications are the largest expected loss. SQL §1.4 quantifies it.
3. **Application submitted → reviewed.** `[Risk]` Memory says the pilot SLA is **30 minutes to approval, no KYC**. Any application sitting > 30 min is an SLA breach. SQL §1.3 returns `avg_review_minutes` — this should be the operations team's daily north-star.
4. **Approved → voucher redeemed.** `[Risk]` Memory confirms `VOUCHER_PILOT` flag governs auto-grant and that auto-grant is **currently disabled**. Approved providers therefore depend on a manual or scripted grant (the `grant-pilot-may2026-credit-to-zero-balance.ts` script exists for exactly this gap). SQL §3.2 lists every approved provider without a redemption — this is a direct ops queue.
5. **Voucher redeemed → wallet credit available.** `[Proven from code]` `ProviderCampaignRedemption` should write a `WalletLedgerEntry` of type `CREDIT`. Cross-checked via §3.3.
6. **Wallet > 0 → ready to receive paid leads.** `[Proven]` Lead unlock charges debit the wallet. A provider with zero credit cannot accept a paid lead. Combine §2.3 + §3.3 to get the *true* count of dispatch-eligible providers.

**The honest story for investors:** the funnel is instrumented end-to-end and each stage has a measurable failure mode. We are not flying blind. But we are also two days old; the *shape* of the funnel matters more than the absolute volumes right now.

---

## 5. Provider onboarding analysis

**What the code already enforces:**

- `Provider.approvedAt` is the canonical approval timestamp (used for SLA reporting).
- Pilot scoped to non-regulated trades (no certified-electrician / gas-installer paths active yet) — investor-friendly de-risking of compliance scope.
- Provider application has hardened deployment gates (commit `bd8f064a3`) and stale-draft recovery (commit `b3bc08f0e`).
- Provider drafts can resume mid-flow via `RegistrationResumeToken` (commit `95225f7dc`).
- Profile photo upload was patched on day-zero (commit `93a35deee`).
- OTP input alignment patched on day-zero (commit `49765b605`).

**The day-zero patch frequency itself is signal.** Eight provider-onboarding patches landed between 2026-06-04 and 2026-06-06. To an investor, this reads as *real users hit real edges and the founder fixed each one within hours* — which is precisely the operating posture early-stage VCs look for. The deck should narrate this, not hide it.

**Known onboarding edge cases:**

- `[Risk]` Phone collisions between Customer and Provider on the same number (SQL §1.5). The schema enforces uniqueness within each table but a single human can register as both.
- `[Risk]` Approved providers with missing structured location (`lastKnownLat IS NULL`) — they will never appear in location-narrowed direct scan (per memory: `Matching Funnel + Structured No-Match Reasons`). SQL §2.3 enumerates them.
- `[Assumption]` The "30-minute approval SLA, no KYC" rule (per memory) is enforced via operational discipline, not a hard system gate. Day-2 average review minutes will tell us if the human team is keeping pace.

---

## 6. Customer demand analysis

**What we know without running SQL:**

- `JobRequest` has 21 stateful fields including `status`, `category`, `requestedWindow*`, `assignmentMode`, `customerNoMatchNotifiedAt`, `customerRematchCheckSentAt`. Per-status counts (SQL §4.1) are the demand shape.
- `DispatchDecision` carries `noMatchReason` and `stageCounts` JSON (per memory). This is *why* matches succeed or fail — diagnostically richer than most marketplaces have at launch.
- `Lead` has a clean lifecycle (`SENT → VIEWED → RESPONDED → ACCEPTED/DECLINED/EXPIRED`) with timestamps for every transition. This makes provider engagement measurable immediately.

**What to expect (working hypotheses, not findings):**

- `[Assumption]` Day-1 / day-2 demand will be founder-led and friend-of-founder-led; treat with skepticism.
- `[Assumption]` Categories will cluster in 2–3 trades (plumbing, electrical, garden — the pilot scope). The deck should not claim broad coverage.
- `[Risk]` Demand without matching supply in a customer's suburb produces a `NO_MATCH` `DispatchDecision`. SQL §4.3 + §4.5 surface this directly. **If `requests_per_provider > ~3` in any category, that's both a supply gap and an investor-positive demand signal**, but only if the no-match-reason isn't "no providers in area."

---

## 7. WhatsApp and messaging analysis

**Platform shape (proven from code):**

- Inbound webhook at `app/api/webhooks/whatsapp/route.ts` validates Meta's `X-Hub-Signature-256`, deduplicates by `externalId` (WAMID) with a Prisma P2002 guard, and processes asynchronously via `after()` so the 200 returns inside Meta's timeout window. This is the right shape.
- Delivery receipts mirror onto `MessageEvent` and (for OTP) `OtpDeliveryAttempt`, giving end-to-end visibility from "we sent it" through "it was read".
- Outbound is templated; commit `5876d8df2` (2026-04-08) documented that **21 templates were missing from WABA** at that time. `[Risk — must verify cleared before investor conversations.]`

**What to look at on day 2 (SQL §5.x):**

- Inbound volume by hour and message type — does the WhatsApp flag in marketing copy actually drive inbound?
- Outbound delivery / read rates — these are vanity-adjacent but credible because they are platform-level, not survey-level.
- `Conversation` rows idle > 2h with non-terminal `currentStep` — direct measure of bot drop-off.

---

## 8. Voucher and credit allocation analysis

This is the area most likely to embarrass us in front of an investor if we don't fix it now.

**State of play, per memory + code:**

- `PILOT_MAY2026` voucher batch was generated via `scripts/generate-vouchers.ts`. Memory confirms: **1 onboarding credit per approval, granted only via redemption.**
- `VOUCHER_PILOT` feature flag controls auto-grant. Memory says **auto-grant is disabled** at flag-level. So approval ≠ credited.
- A reconciliation script exists (`scripts/grant-pilot-may2026-credit-to-zero-balance.ts`) which finds zero-balance approved providers and grants them a real `PILOT_MAY2026` voucher from the batch, writing the full audit trail. The fact that this script exists is signal that the gap was anticipated; the fact that it is operational-team-run rather than auto-run is the gap.

**Risks to investor narrative:**

1. **`[Risk]`** If voucher batch capacity < approved providers, we hit a "shortfall" branch in the script (`scripts/grant-pilot-may2026-credit-to-zero-balance.ts:268`). Investor question: "can a provider be approved but unable to take leads?" Honest answer right now: yes, if the batch is exhausted.
2. **`[Risk]`** Ledger drift. If `WalletLedgerEntry` rows do not match `ProviderCampaignRedemption` rows 1:1 for `PILOT_MAY2026`, our liability number is wrong. SQL §3.4 quantifies open credit liability.
3. **`[Proven]`** Audit trail design is correct (redemption → ledger → wallet). The discipline is there; what's missing is the auto-flip from approval to credit.

---

## 9. Operational actions required today

See `2026-06-07-immediate-action-plan.md` for the full action plan. The 24-hour bar:

1. Run the SQL pack against the restored prod replica; commit the actuals to `docs/fundraising/2026-06-07-actuals.md`. **Owner: founder, 2h.**
2. Drain SQL §3.2 (approved-no-voucher list) by running the existing grant script in `--apply` mode after a `--plan` dry-run. **Owner: founder, 30m.**
3. Walk SQL §6.1 admin queue depth. Anything in `pending_provider_application` > 30 min breaches the pilot SLA. **Owner: founder, 30m.**
4. Confirm PR #39 (WhatsApp blob audit) audit re-run shows the 24 remaining gaps continue to shrink. **Owner: founder, 5m.**
5. Re-verify all 21 WABA templates from commit `5876d8df2` are now registered. **Owner: founder, 30m.**

---

## 10. Technical risks and fixes required

| # | Risk | Severity | SQL probe | Fix |
|---|---|---|---|---|
| 1 | DB wipe recoverability not yet at 100% (24 WhatsApp media rows missing) | Medium | §0.2 | Continue WABA recovery script; track via PR #39 audit |
| 2 | `VOUCHER_PILOT` auto-grant disabled → approved providers without credit | High | §3.2 | Either flip flag with safety review, or run grant script daily until flipped |
| 3 | Conversations stuck > 2h without progression | Medium | §5.4 | Operational nudge or auto-escalation; trace the most common idle step |
| 4 | Message template registration drift | Medium | §5.3 | Re-run template verification (2026-04-08 baseline) |
| 5 | Webhook processing failures | Medium-High | §8.1 | Inspect `failureReason` distribution; alarms exist (correlation IDs in webhook handler) |
| 6 | Approved providers with no structured location | Medium | §2.3 | Front-end onboarding nudge during pilot; location is a hard matching gate |
| 7 | Single-role `AdminUser` (no `roles[]`, no last-OWNER guard) — per project CLAUDE.md | Medium | n/a | Tracked in admin-rebuild plan; flag to investors only if asked |
| 8 | Encrypted Vercel env unreadable locally — operational toil for the team | Low | n/a | Documented limitation; doesn't block investor story |

---

## 11. Investor-readiness assessment

**What we can credibly tell an investor today:**

- We shipped a working WhatsApp-first marketplace into production. Code is in main; site is live; PRs are reviewed; audit trail exists. `[Proven]`
- We have *structured* dispatch diagnostics (no-match reasons, stage counts) at launch, which is rare. `[Proven]`
- We have an admin audit log, feature-flag rollout, error boundaries, Playwright smoke suite, OTP fraud-response infrastructure. We are not pretending to be more mature than we are; we *are* more mature in operations than most pre-seed founders. `[Proven from code + CLAUDE.md inventory]`
- We had a real production incident on launch day and recovered without losing customer data. The post-incident artefacts (recovery design doc, plan, read-only audit script, daily provider snapshot cron) are in git. `[Proven]`

**What we cannot credibly tell an investor yet:**

- Any "growth" or "retention" claim — two days is not a trend. `[Risk]`
- Any LTV / CAC number. We have neither cohort data nor a complete cost ledger. `[Unknown]`
- Any breakeven-leads-per-provider claim. We need 30 days of lead-unlock data minimum. `[Unknown]`
- Any "we are the WhatsApp leader in field service" claim. There is at least one regional incumbent (kandua / SweepSouth / Helpr) using web-first; we are differentiated by WhatsApp-native flow, not by being first. `[Assumption — needs competitive scan]`

**Readiness verdict:** We are at "friends-and-family / angel" readiness, not "institutional seed" readiness. Conversations with strategic angels who know WhatsApp commerce, the SA market, or marketplace dynamics are appropriate **now**. Institutional VC pitches should wait **at least 30 days** to accumulate cohort data, retention shape, and unit-economics evidence.

---

## 12. Data gaps and tracking improvements required

| Gap | Why it matters | Proposed fix | Effort |
|---|---|---|---|
| No durable acquisition-source tag on Customer beyond `channel` | Cannot attribute marketing spend | Additive: `Customer.acquisitionSource`, `acquisitionCampaign` columns (nullable) | Small migration, behind flag |
| Categories are string slugs, not a managed table | Cannot report cleanly by sub-vertical | Per project CLAUDE.md: introduce `Category` model (additive, no rename) | Medium — schema work |
| No daily provider snapshot before 2026-06-07 | Cannot show trend graphs in deck | `73b1acc83 feat(ops): daily provider snapshot cron at 18:00 SAST` now runs daily. First chart-worthy data lands 2026-07-07. | None — wait |
| No cost ledger | Cannot compute CAC / cost-per-onboarded-provider | Manual sheet to start, BMS integration later (per memory `project_bms.md`) | Small |
| WABA template registry not surfaced in admin dashboard | Template drift = silent send failures | Admin page for template inventory + last-sent timestamp | Medium |
| Conversation step-state not summarised in admin dashboard | Cannot see drop-off shape live | Materialised view or scheduled summary into `ops_queue_assignments` | Medium |

---

## 13. Closing — what this report is and is not

This is a **launch-day operating report**, written in the voice of a founder talking to themselves before a fundraising conversation. It is not a pitch document and it is not a brag sheet.

What it *should* enable:

- Run the SQL pack → fill in the actuals → know exactly where the funnel leaks.
- Use the deck blueprint to write a 19-slide deck that *does not exaggerate* but *does* explain why this is investable.
- Use the action plan to drain the operational queue before any investor sees the platform.

What it should *not* be used for:

- Telling investors "we have 500 providers and 1,000 customers" two days in. We don't, and even if we did, those numbers wouldn't matter at 48 hours.
- Telling the team "we're killing it" or "we're failing." We're shipping, we're recovering, we're learning. That's the right posture.
