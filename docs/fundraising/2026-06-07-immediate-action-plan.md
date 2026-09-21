# Plug A Pro — Immediate Action Plan

**Date authored:** 2026-06-07
**Companion:** `2026-06-07-launch-performance-report.md`, `2026-06-07-investor-deck-blueprint.md`, `2026-06-07-metrics-sql-pack.sql`
**Production-safety reminder:** every action below is **either read-only investigation** or **uses already-shipped reconciliation tooling**. Anything that writes is explicitly tagged `[WRITE]` and named with the exact script + dry-run / confirm path.

---

## Next 24 hours (today + tomorrow morning)

| # | Action | Owner | Effort | Type | Done when |
|---|---|---|---|---|---|
| 1 | Run `2026-06-07-metrics-sql-pack.sql` against the restored prod replica. Paste every result block into a new file `docs/fundraising/2026-06-07-actuals.md`. | Founder | 60 min | Read-only SELECT | Every metric in the report has a number next to it |
| 2 | Re-run the WhatsApp blob audit script and confirm the 24 remaining missing-row gaps continue to shrink: `cd field-service && pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out ./recovery`. | Founder | 5 min | Read-only | Output prints fewer missing rows than the last run |
| 3 | Walk the approved-no-voucher list from SQL §3.2. For every row, decide: grant via script or hold. | Founder | 20 min | Decision only | Decisions captured in a comment column of the SQL result |
| 4 | `[WRITE]` Drain the approved-no-voucher queue using the existing reconciliation script: `pnpm tsx scripts/grant-pilot-may2026-credit-to-zero-balance.ts --plan` (dry-run first), then `--apply --confirm` for the chosen rows. **Do not** flip `VOUCHER_PILOT` flag without a separate review. | Founder | 15 min | Controlled mutation via existing script + flag-bounded | Script reports zero shortfall and zero new redemptions remaining |
| 5 | Walk SQL §6.1 admin queue depth. Anything in `pending_provider_application` > 30 min breaches the pilot SLA — clear it manually. | Founder | 30 min | Read-only + manual review | Queue depth = 0 for the 30-min SLA bucket |
| 6 | Re-verify the 21 WhatsApp template registry items flagged on 2026-04-08 (commit `5876d8df2`, `docs/whatsapp-template-verification-2026-04-08.md`). | Founder | 30 min | Read-only in WABA console | Every template marked `APPROVED` in WABA, none rejected |
| 7 | Skim the day-2 webhook failure distribution (SQL §8.1) and confirm no spike during peak hour. | Founder | 10 min | Read-only | If spike present: file an incident note and add owner / fix to the 7-day list |

**24-hour exit criteria:** every metric in the report has an actuals number, queue depth is 0 against SLA, approved-no-voucher list is drained, recovery audit is still green.

---

## Next 7 days

### Funnel and ops

| # | Action | Owner | Effort | Done when |
|---|---|---|---|---|
| 8 | Identify the most common idle `Conversation.data.currentStep` from SQL §5.4. Decide if a bot nudge or admin handoff is appropriate. | Founder | 1 day | Top step identified + escalation rule designed |
| 9 | Stand up a daily 18:00 SAST "ops standup" (15 min) keyed off the SQL pack rerun. The cron `73b1acc83 feat(ops): daily provider snapshot cron at 18:00 SAST` already writes a snapshot; build the rest of the daily look around it. | Founder | 30 min setup | Five-day streak of consistent daily runs |
| 10 | Walk the demand-vs-supply gap from SQL §4.5. Pick the top 1 category × suburb pair where requests > providers and run a targeted provider acquisition push there. | Founder | 2–3 days | Net new approved-with-credit providers in that pair > 5 |
| 11 | `[WRITE — flag-flip review]` Decide whether to flip `VOUCHER_PILOT` flag to enable auto-grant on approval. If yes, do it in a dedicated PR with the safety review and rollback note. | Founder | 2h decision, 1d execution | Flag state matches intended Phase-1 model; ledger drift = 0 |
| 12 | Add an admin dashboard tile for the SQL §6.1 result (admin queue depth). Use the existing CRUD kit pattern in `field-service/components/admin/crud/`. | Founder + AI session | 1 day | Admin lands → sees three numbers: pending applications, no-match requests, idle conversations |

### Tracking and analytics improvements

| # | Action | Owner | Effort | Done when |
|---|---|---|---|---|
| 13 | Add `Customer.acquisitionSource` + `Customer.acquisitionCampaign` (nullable). Additive migration only. Capture from WhatsApp template / PWA query string. | Founder + AI session | 1 day | Migration applied; new customers have source set; legacy rows null |
| 14 | Define test-cohort tags (`cohortName LIKE 'TEST_%'`) and seed a small known-good test cohort for repeatable smoke through prod flows. | Founder + AI session | 0.5 day | E2E smoke run uses a known cohort; metrics exclude it |
| 15 | Expose the `noMatchReason` + `stageCounts` distribution in the admin dashboard. The data is already in `DispatchDecision`; this is purely a read-side render. | Founder + AI session | 1 day | Admin can see why matches fail this hour, today, this week |

### Investor preparation (parallel, not blocking)

| # | Action | Owner | Effort | Done when |
|---|---|---|---|---|
| 16 | Write the cost-line sheet for Slide 11: WhatsApp template costs, Vercel + Supabase actual bills, Peach PSP %, Didit unit price (paused but priced), hosting per active provider. | Founder | 1 day | Sheet committed to `docs/fundraising/2026-06-07-cost-build.md` |
| 17 | Write the use-of-funds budget for Slide 16. Tie each rand to an output. | Founder | 1 day | Budget sheet committed; defensible to a 30-minute Q&A |
| 18 | Do the competitive scan for Slide 13 — SweepSouth, Kandua, Helpr, plus any 2026 entrants. Single page. | Founder | 0.5 day | One-page table committed to `docs/fundraising/2026-06-07-competitive-scan.md` |
| 19 | Draft the founder-narrative one-pager for Slide 18 (operating track record across AITrader, CycleDesk, MyZaca, Plug A Pro). | Founder | 0.5 day | Bio document committed |

---

## Before speaking to any institutional investor

Treat all of these as gates. Conversations with strategic angels can proceed in parallel.

| # | Gate | Why it matters |
|---|---|---|
| G1 | 30 days of post-launch cohort data | A two-day picture is unprofessional in front of a fund. Daily snapshots accumulate the picture. |
| G2 | A real CAC measurement from at least one paid acquisition test | The Slide 11 unit economics must be measured, not modelled. |
| G3 | Cleared `VOUCHER_PILOT` flag decision (on or off, justified) | An investor will ask "what happens when a provider is approved?" The answer cannot be "depends if I remembered to run a script." |
| G4 | Cleared all 21 WABA templates verified live | Silent send-failure is the worst failure mode. |
| G5 | Defensible market sizing (Slide 6) and competitive scan (Slide 13) | Both currently are weak; either fix or be ready to concede in the room. |
| G6 | An admin dashboard tile for: pending approvals, no-match reasons, queue depth | Demonstrates operating cadence visually. Without it the maturity claim is verbal only. |
| G7 | Use-of-funds tied to deliverables | "Why R[X]m?" cannot be answered with vague generalities. |
| G8 | Founder bio one-pager + 90-day plan tied to the funnel | Operating posture must be readable in 60 seconds. |
| G9 | One real customer story written up (with permission) | Anchors the deck in lived experience, not abstractions. |
| G10 | Closure on the DB-wipe incident: postmortem committed, recovery 100% verified, prevention rules documented | This will come up. Have the answer in your back pocket as a one-pager. |

When G1–G10 are met: institutional outreach is appropriate. Until then, the high-leverage moves are (a) strategic angels who can open doors, (b) operational depth.

---

## Analytics / funnel-tracking / dashboard improvements

These are not blocking the deck but are the next infrastructure layer after the 7-day list.

| # | Improvement | Why | Effort |
|---|---|---|---|
| A1 | Materialised view of funnel state by day (registrations → applications → approvals → credited → first-lead → first-match) | One query answers "show me the funnel for last week" | 1 day |
| A2 | Conversation step-state summariser table (refresh hourly from `Conversation.data`) | Today the data is interrogable but slow; this makes drop-off visible at a glance | 1 day |
| A3 | `Category` model + `CategoryRequiredCertification` + `CategoryRequiredEquipment` (per project CLAUDE.md) | Replace string-slug categories with managed data; investor question "how do you manage trade-specific requirements?" deserves a structured answer | 3 days |
| A4 | Daily ledger reconciliation: every approved provider has exactly one `PILOT_MAY2026` redemption + exactly one wallet CREDIT line | Liability number is correct; investor question "what is your open credit liability?" gets a number, not a shrug | 1 day |
| A5 | Webhook health monitor on the home admin page | Operational visibility for the team without needing to read logs | 1 day |
| A6 | Cost ledger table tied to BMS (per memory `project_bms.md`) | Phase-2 unit economics: cost-per-onboarded-provider in the dashboard, not a sheet | 1 week |
| A7 | Acquisition-source attribution funnel | Once `Customer.acquisitionSource` exists (Action #13), report by source | 1 day |
| A8 | `nodeEnv` / `cohortName` separation visible everywhere | Avoids any chance of test rows polluting investor numbers | 0.5 day |

---

## Process discipline that should already be in place

These are reminders, not new work — they are already in the project's operating posture and just need to be honoured during fundraising:

- Every admin mutation goes through `crudAction()` (project CLAUDE.md, house rule #1).
- No schema drops or renames in feature PRs — additive only (house rule #2).
- Every admin-facing feature ships behind a flag and is flipped separately (house rule #5).
- Every PR touching admin flows extends Playwright smoke coverage (house rule #6).
- No hard deletes without `OWNER` role (house rule #3).
- Every action confirmed before destructive (house rule #4).

If we slip any of these in the rush to get fundraise-ready, we erase the very thing we are pitching.
