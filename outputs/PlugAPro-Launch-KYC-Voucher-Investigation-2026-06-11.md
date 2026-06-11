# Plug A Pro — Launch KYC Voucher / Campaign Discount Model

**Additional investigation appended to the KYC fee-recovery options report.**
Date: 2026-06-11 · App: `field-service/` (Next.js App Router + Prisma + Supabase Postgres) · Vendors: Didit (primary), Smile ID (adapter)

---

## Executive summary

**The platform can support automatic launch-KYC sponsorship, but not by reusing the existing voucher tables.** The current voucher system grants **wallet credits** via a **manually-typed printed code** and has **no concept of a fee, a fee offset, an area scope, or a per-campaign allocation cap**. The "once-off KYC / ID verification recovery fee" itself is **not implemented anywhere in code today** — it is a proposal (Options A–D of the parent report). So we are designing the fee model and its sponsorship together, on a clean slate, on top of a mature wallet-ledger and KYC-verification spine.

**Recommendation in one line:** build a small, purpose-made `KycCampaign` + `KycSponsorship` model that **auto-grants on successful KYC verification** when the provider's area matches an **active, area-scoped, count-capped** campaign, records the sponsorship as **rand-denominated KYC-fee ledger reason codes** (kept out of the integer credit wallet), de-duplicates on the **verified ID-number hash** (not just provider id), and **falls back to the normal first-top-up fee recovery** once the allocation is exhausted. Reuse the *patterns* already proven in the codebase (atomic campaign-redemption dedup, lifecycle auto-grant with a unique idempotency key, `crudAction` audit) — do **not** reuse the printed-flyer `PromoVoucher` row.

**Smallest safe MVP:** one new campaign table, one new sponsorship table, four KYC-fee ledger reason codes, an auto-grant hook on the KYC `PASSED` transition with an atomic allocation decrement, an admin create/pause/close + usage screen, and a provider-facing "your verification is sponsored" message. Vendor (Didit) 500/month free-tier usage stays a **manual monthly reconciliation** at first, surfaced as an admin number — it is a separate counter from the campaign cap and should not gate the campaign.

---

## How this slots into the parent report

The parent report compares KYC fee-recovery models:

- **Option A** — Provider pays the KYC fee up front.
- **Option B** — Fee accrued and recovered from first top-up.
- **Option C** — Fee waived by admin (discretionary).
- **Option D** — (assumed) hybrid / deferred recovery.

This addendum adds **Option E** (launch-campaign sponsored KYC) and **Option F** (hybrid: sponsored while allocation lasts, then fall back to first-top-up recovery), plus the supporting campaign/area/allocation/ledger/admin/edge-case analysis the brief requested, and the **Section 17** recommendation.

---

# Part 1 — Current-state findings (evidence)

Every claim below is grounded in the live tree (`.worktrees/`, `node_modules/`, `.claude/worktrees/` excluded).

## What already exists

| Capability | Status | Where |
|---|---|---|
| Voucher batches + codes | **Exists** (printed-flyer pilot) | `prisma/schema.prisma:1419` `VoucherBatch`, `:1438` `PromoVoucher` |
| Per-provider-per-campaign dedup | **Exists** (DB unique) | `ProviderCampaignRedemption @@unique([providerId, campaignCode])` `schema.prisma:1480` |
| Redemption attempt analytics + rate limiting | **Exists** | `VoucherRedemptionAttempt` `schema.prisma:1485`; `lib/rate-limit.ts:103` |
| Lifecycle auto-grant with idempotency | **Exists but deactivated** | `ProviderPromoAward @@unique([providerId, awardType])` `schema.prisma:1413`; `lib/provider-promo-awards.ts:17` |
| Post-approval side-effect runner | **Exists** | `ProviderAutoApproveSideEffectMarker` `schema.prisma:1512`; `lib/provider-auto-approve.ts:331` |
| Credit wallet + immutable ledger | **Exists, robust** | `ProviderWallet`/`WalletLedgerEntry` `schema.prisma:1347`,`1365`; `lib/provider-wallet.ts` |
| KYC verification state machine + vendors | **Exists, mature** | `lib/identity-verification/orchestrator.ts`; Didit/Smile/manual/mock adapters |
| Per-verification vendor cost | **Exists (display-only)** | `ProviderIdentityVerification.costEstimateCents` `schema.prisma:1060` |
| Admin KYC approve/reject/retry/override | **Exists** | `app/(admin)/admin/verifications/actions.ts`; `setProviderKycAction` `app/(admin)/admin/providers/actions.ts:385` |
| Admin voucher screen | **Exists, read-only** | `/admin/vouchers` list + cancel only; flag `admin.vouchers` |
| Audit on every admin mutation | **Exists** | `crudAction()` writes `AuditLog` + `AdminAuditEvent` atomically; `lib/crud-action.ts:133` |
| West Rand launch definition | **Exists** | `lib/launch/west-rand-pilot.ts` (`regionKey 'jhb_west'`, 8 suburbs) |

## What does NOT exist (all new)

| Gap | Consequence for this feature |
|---|---|
| **No KYC fee in code at all** | The R20 recovery fee is unbuilt; sponsorship has nothing to "offset" yet. Both must be designed together. |
| **No fee / charge concept in the wallet** | `WalletLedgerEntryType` has no fee code; balances are credits only (1 credit = R50). A R20 fee can't be a clean integer credit. |
| **Vouchers grant credits, not fee offsets** | `PromoVoucher.creditAmount` adds promo credits; there is no `benefitType`/`feeWaiver`. |
| **Vouchers are manual-redeem only** | Provider types `PAP-XXXX-XXXX` via WhatsApp/PWA. No auto-grant path. Brief requires *no manual redemption*. |
| **No area / province / suburb / status / start-date scope on vouchers** | Only `campaignCode` + `expiresAt` + code possession. |
| **No allocation cap concept** | `VoucherBatch.count` = number of printed codes, not a "first N qualifying providers" cap. No pause/close/start-date/`status`. |
| **Auto-grant promo awards are dead code** | Only `MOBILE_VERIFIED` is active (3 credits); `KYC_APPROVED`, `FIRST_TOPUP` throw `UNKNOWN_AWARD_TYPE` (`lib/provider-promo-awards.ts:96`). Disabled in favour of the voucher pilot (`provider-auto-approve.ts:339`, reason `PROMO_AWARD_DISABLED_VOUCHER_PILOT`). |
| **No vendor allocation tracking** | The Didit "first 500 Full-KYC bundles/month" free tier is *intentionally not modelled* (`lib/commercial/didit-pricing.ts:11`); reconciled against the Didit invoice externally. |
| **No reliable area field at KYC time for WhatsApp providers** | `TechnicianServiceArea` (authoritative, has `regionKey`) is only written on the PWA draft path; WhatsApp-onboarded providers have only free-text `Provider.serviceAreas`. |
| **No campaign/voucher/KYC reporting** | `/admin/reports` is a month-to-date KPI dashboard only. |
| **No structured-config home** | `FeatureFlag` is boolean-only; `settings` page is static. A campaign needs its own table. |

---

# Part 2 — Research questions

## 1. Current campaign and voucher capability

- **Vouchers / campaigns / promotions / credits supported?** Partly. There is a **printed-flyer voucher** system (`VoucherBatch` + `PromoVoucher`) and a **lifecycle promo-award** system (`ProviderPromoAward`). Both deliver **wallet credits**. There is **no promotion, discount, or credit that offsets a fee**, and **no "campaign" entity** beyond a `campaignCode` string on a batch.
- **Manual, automatic, or both?** Vouchers are **manual** — the provider types a code via WhatsApp ("REDEEM") or PWA (`lib/voucher-redemption.ts:51` → `creditVoucherRedemptionInTransaction` `lib/provider-wallet.ts:249`). The **automatic** path (`ProviderPromoAward`) exists but is **deactivated** — only `MOBILE_VERIFIED` is allowed.
- **Scopable by provider / campaign / area / province / suburb / date / status?** Only by **campaignCode**, **expiry date** (`expiresAt`, upper bound only), **code possession**, and an implicit **provider must be `status = ACTIVE`** gate (`voucher-redemption.ts:106`). **No** area, province, suburb, provider-status-other-than-active, or start-date scoping exists.
- **Duplicate grants prevented?** Yes, robustly: DB unique `ProviderCampaignRedemption(providerId, campaignCode)`, atomic voucher claim (`updateMany WHERE status='ACTIVE'`), and Upstash rate limiting. This dedup pattern is directly reusable.
- **Tables / enums / functions / APIs / admin screens:** `VoucherBatch`, `PromoVoucher`, `ProviderCampaignRedemption`, `VoucherRedemptionAttempt`, `ProviderPromoAward`; enums `VoucherStatus`, `WalletLedgerEntryType` (incl. `VOUCHER_REDEMPTION`), `ProviderPromoAwardType`; functions in `lib/vouchers.ts`, `lib/voucher-redemption.ts`, `lib/provider-wallet.ts`, `lib/provider-promo-awards.ts`; creation via `scripts/generate-vouchers.ts` (CLI only); admin at `/admin/vouchers` (read-only list + cancel, flag `admin.vouchers`).

## 2. Auto-granting launch KYC vouchers

- **Can it auto-grant during onboarding?** Yes — the infrastructure exists (`ProviderAutoApproveSideEffectMarker` runner; `ProviderPromoAward` with built-in `@@unique` idempotency). The lifecycle auto-grant is currently switched off but is the right mechanism to revive for this purpose.
- **At which point?** Candidate hooks and the data available at each:

  | Hook | Code event | Area data available? | Verdict |
  |---|---|---|---|
  | (a) Registration | draft/conversation created | No (area not chosen; no provider id) | Too early |
  | (b) Area selection | write to `ProviderApplicationDraft.locationNodeIds` | Yes (PWA only); draft may be abandoned | Too speculative |
  | (c) KYC submission | verification row → `SUBMITTED` | Partial; outcome unknown | Risks sponsoring failures |
  | (d) **Successful KYC verification** | `kycStatus → VERIFIED` on `PASSED/PASS` (`orchestrator.ts:535`, webhook `app/api/webhooks/verification/[vendor]`) | **Yes — full provider record** | **Recommended trigger** |
  | (e) Admin approval | `approveApplication` (`applications/page.tsx:186`) | `serviceAreas` free-text only (no `locationNodeIds`) | Viable fallback, weaker area data |
  | (f) First top-up | `creditPaymentIntentInTransaction` | Yes, but after KYC | Too late to "sponsor the KYC fee" |

- **Safest trigger:** **(d) successful KYC verification.** At that moment the provider exists, the **identity is verified** (so anti-fraud dedup on the real ID hash is possible), the **vendor cost has actually been incurred** (so sponsoring a real cost, not a hypothetical), and `Provider.kycStatus = VERIFIED` is already the gate used elsewhere (`lib/identity-verification/credit-gate.ts:68`). Granting earlier risks sponsoring abandoners and people who fail.
- **When should the voucher be consumed?** Consume at the **same moment it is granted — successful verification** — because that is when the sponsored fee is actually booked. (See Q4 for why grant-on-success beats reserve-on-attempt for the MVP.)

## 3. Area-based launch campaign rules

- **Can the system identify the provider's launch area reliably?** **For West Rand, yes; in general, partially.** `lib/launch/west-rand-pilot.ts` defines `regionKey = 'jhb_west'` and 8 active suburbs. A provider maps in via `TechnicianServiceArea.regionKey` (authoritative) **or** a slug in `Provider.serviceAreas` (legacy). **Reliability gap:** WhatsApp-onboarded providers have **no `TechnicianServiceArea` rows** — only free-text `serviceAreas` — so matching for them depends on string slugs. There is **no single launch-area field** on `Provider` (the `cohortName` field is for test routing, not geography).
- **How is area stored?** Three ways: `Provider.serviceAreas: String[]` (legacy free-text/slugs), `TechnicianServiceArea` (relational, denormalised `provinceKey`/`cityKey`/`regionKey`/`suburbKey`, the authoritative model), and `ProviderApplication.serviceAreas: String[]` (input). `LocationNode` hierarchy is `PROVINCE → CITY → REGION → SUBURB`, slug pattern `{province}__{city}__{region}__{suburb}`.
- **Can a campaign target "West Rand" / "Western Cape" / "Durban"?** **West Rand → yes**, as `regionKey = 'jhb_west'`. **Western Cape / Durban → not yet** — only West Rand has a pilot config and active-suburb list; a new launch region needs its own definition. A campaign should scope by a **`LocationNode` reference at a chosen level** (region for West Rand, province for "Western Cape", city for "Durban") so all three are expressible once the nodes exist.
- **Multi-area providers:** A provider can hold multiple `TechnicianServiceArea` rows. Rule: a provider **qualifies if *any* of their areas falls inside the campaign's scope** (the existing `buildAreaProviderWhere` uses `some`). Each provider is still sponsored **once** per campaign (dedup), so multi-area does not multiply benefit.
- **Providers outside the launch area:** They simply **don't match an active campaign** → fall straight to the normal KYC fee path. Out-of-area customers/providers are already captured in `ServiceAreaWaitlist` (free-text `city`); no notify automation exists yet.

## 4. Campaign allocation and limits

- **Configurable allocation:** Store a per-campaign `maxSponsoredCount` (the "first 200/300/…") on the new campaign table — **never hardcoded**. Combine with `startsAt`/`endsAt` for a date-limited window and a `LocationNode` scope for area-specific allocation. A monthly cadence is expressed as a campaign per month (or a `monthlyCap` field if you want a single rolling campaign).
- **How to count usage — options:**

  | Count on | Pro | Con |
  |---|---|---|
  | Voucher granted (at qualification, pre-KYC) | Deterministic "first N to sign up" | Wastes allocation on abandoners & failures; sponsors checks that may never happen |
  | KYC verification **attempted** | Matches *vendor* cost (each check costs/consumes a bundle) | A provider can attempt+retry → several vendor checks per person; over-counts people |
  | **KYC verification successful** | Ties the cap to a **real verified identity** and a **real incurred cost**; most auditable | "First N to *pass*", not "first N to *start*" — slightly different promise |
  | Provider approved / activated | Aligns with activation | Decoupled from the KYC cost the fee recovers; later than needed |

- **Recommended counting method (cleanest + most auditable):** **count successful sponsored verifications** — i.e. one `KycSponsorship` row transitions to `CONSUMED` (and one `KYC_FEE_SPONSORED` ledger row is written) per provider, atomically decrementing the campaign's remaining allocation **in the same transaction** as the `kycStatus → VERIFIED` write. The campaign's authoritative "used" number is `count(KycSponsorship WHERE campaignId = X AND status = CONSUMED)`; a cached `sponsoredCount` on the campaign row makes admin reads cheap, reconciled from the ledger. This counter is **distinct from** the vendor free-tier counter (Q5).
- **Optional enhancement (not MVP):** if marketing must promise "first 200 to *start*", add a **reserve-on-attempt, consume-on-success, release-on-failure/TTL** two-phase flow. It is more complex and only needed if pre-commitment messaging matters. Start with grant-on-success.

## 5. Monthly free ID-check allocation (vendor)

- **Tracked today?** **No.** `lib/commercial/didit-pricing.ts:11` states the "first 500 Full-KYC bundles/month" free tier is **intentionally not modelled**; the pricing module returns headline rates and **monthly reconciliation happens against the Didit invoice** externally. `costEstimateCents` is stamped per verification (Didit only) but is **display-only and never aggregated**.
- **Can the 500 be represented?** Yes — but it is a **vendor-cost counter**, not the campaign cap. Keep them separate. **Phase it:** start **manual** (an admin-entered monthly allowance + a count of checks performed this month, shown on an admin card), then **systematise** later by aggregating `ProviderIdentityVerification` rows per calendar month (counting checks that `countTowardAttemptCap`).
- **What to track (when systematised):** monthly free-check **allowance**, checks **used**, checks **remaining**, **paid** checks (over the free tier), **campaign-sponsored** checks (subset), **failed** checks, **duplicate/abandoned** attempts, and a **vendor reconciliation** line (system count vs invoice count). A small `VendorVerificationUsage` (vendorKey, periodMonth, allowance, used, …) table or a monthly report query covers this.
- **Crucial distinction:** vendor cost is incurred on **every attempt** (incl. retries and failures); the campaign benefit is consumed on **successful sponsored verifications only**. The two numbers will differ, by design.

## 6. Ledger design for sponsored KYC

**Key correctness point:** the credit wallet (`WalletLedgerEntry`) is **integer credits** where 1 credit = R50. A **R20 KYC fee is not a clean credit amount** (0.4 credits). **Do not push rand fees through the credit ledger.** Instead, model the KYC fee in a **dedicated rand-denominated ledger** (cents), and have the provider's wallet **history view merge** both ledgers for display. This keeps credit accounting correct while still showing the provider one timeline.

Proposed KYC-fee ledger reason codes (rand cents, on a new `KycFeeLedgerEntry` or reused on the sponsorship/verification record):

| Reason code | Meaning |
|---|---|
| `KYC_FEE_ACCRUED` | Provider owes the once-off R20 recovery fee (booked when the check is performed). |
| `KYC_FEE_RECOVERED` | Fee recovered (from first top-up, per Option B). |
| `KYC_FEE_WAIVED` | Fee written off by admin (Option C / discretionary). |
| `KYC_FEE_SPONSORED` | Fee covered by a launch campaign (no recovery owed). **This is the campaign-usage counter.** |
| `LAUNCH_KYC_VOUCHER_GRANTED` | A sponsorship was granted/reserved to the provider under a campaign. |
| `LAUNCH_KYC_VOUCHER_CONSUMED` | The granted sponsorship was applied to a real KYC fee (pairs with `KYC_FEE_SPONSORED`). |
| `LAUNCH_KYC_VOUCHER_REVERSED` | A granted sponsorship was reversed (failed KYC / abandonment / admin revoke / duplicate). |
| `FIRST_TOPUP_KYC_DEDUCTION` | The recovery deduction taken at first top-up (Option B path; **rand**, recorded in the KYC-fee ledger, *not* as a credit debit). |

The ledger must record, per row: **provider**, **campaignId**, **area/launch batch** (campaign carries the `LocationNode` scope), **grantedAt**, **consumedAt**, **automatic vs manual** (`source`), **admin actor + reason** for manual overrides (via `crudAction`'s `reason`), and the **outstanding KYC fee balance** (derivable: `accrued − recovered − waived − sponsored`). The existing ledger spine (`createLedgerEntry`, `idempotencyKey @unique`, `db.$transaction`, optimistic concurrency) is the template — the new fee ledger should copy it exactly.

## 7. Product options to compare

### Option E — Launch-campaign sponsored KYC (first configurable N providers in a launch area)

*Example: first 200 providers in a new launch area get automatic KYC sponsorship.*

- **Pros:** Removes the single biggest onboarding-friction point (a fee before any earnings) exactly where supply liquidity matters most — a new area at launch. Automatic (no code to redeem). Capped and area-targeted, so spend is predictable. Funded out of the vendor free tier, so near-zero marginal cash cost while the free tier lasts.
- **Cons:** Needs a new campaign + sponsorship model and a fee model to offset. "First N" creates a soft deadline that can feel arbitrary to provider N+1. If counted on *grant* rather than *success*, allocation leaks to abandoners.
- **Operational impact:** Admin must create/monitor/close campaigns and reconcile the vendor free tier monthly. Support must be able to explain why one provider was sponsored and another wasn't.
- **Fraud risk:** Duplicate accounts to farm sponsored checks. **Mitigated strongly** by granting on *successful verification* and de-duplicating on the **verified ID-number hash** (`ProviderIdentityVerification.identifierHash`), so one human ID = at most one sponsorship per campaign.
- **Ledger impact:** Adds the KYC-fee reason codes above; `KYC_FEE_SPONSORED` is the campaign counter. No impact on credit balances.
- **Improves launch conversion?** **Likely yes** for supply-side onboarding completion in a new area — the fee is removed at the exact step where providers drop off. Measure via sponsored-cohort KYC-completion and first-job rates vs a non-sponsored cohort.
- **Area- / date- / count-based?** **All three, combined:** area-scoped (`LocationNode`), date-windowed (`startsAt`/`endsAt`), and count-capped (`maxSponsoredCount`). The count is the primary control; area defines eligibility; dates bound the window.

### Option F — Hybrid (sponsored while allocation lasts, then normal recovery)

- Launch-area providers get the **automatic KYC voucher while allocation remains**.
- Once exhausted (or window closed / campaign paused), new providers move to the **normal KYC fee recovery from first top-up** (Option B).
- Admin can **extend** (raise `maxSponsoredCount` or `endsAt`), **pause**, or **close** the campaign.
- **This is the recommended production shape.** It bounds spend, degrades gracefully, and keeps a single fee model underneath. Option E is really "Option F without the fallback"; ship F.

## 8. Provider experience (recommended copy)

All copy assumes the fee is the once-off **R20** ID-verification recovery fee. Keep it factual and non-promissory.

| Surface | Sponsored (within allocation) | Not sponsored (allocation ended) |
|---|---|---|
| **Onboarding screen** | "Launch offer: your once-off ID verification fee is sponsored by Plug A Pro for early providers in your area." | "A once-off R20 ID-verification fee applies. You won't pay now — it's recovered from your first top-up." |
| **KYC screen** | "Good news — your ID verification is covered by a Plug A Pro launch voucher. No fee to you." | "Your ID verification carries a once-off R20 recovery fee, deducted from your first top-up." |
| **Wallet screen** | "ID verification fee: R20 — sponsored by Plug A Pro launch campaign (R0 due)." | "ID verification fee: R20 — to be recovered from your first top-up." |
| **Provider dashboard** | "You joined as a launch provider — your ID verification fee was covered by Plug A Pro." | (no banner; fee status shown in wallet) |
| **WhatsApp onboarding** | "✅ You're part of our launch batch, so your ID verification fee has been covered by Plug A Pro. No payment needed to get verified." | "Your ID verification has a once-off R20 fee. You don't pay upfront — we recover it from your first top-up." |
| **Admin note (audit)** | "KYC fee SPONSORED — campaign {code} ({area}), auto-granted on verification {verificationId}." | "KYC fee ACCRUED — normal recovery; campaign {code} allocation exhausted at grant time." |
| **Wallet ledger history** | "Launch KYC voucher applied — ID verification fee sponsored (R20). Campaign: {name}." | "ID verification fee accrued (R20) — recovery scheduled at first top-up." |

Edge-copy when the offer ends mid-session: *"The launch verification offer has just reached its limit. A once-off R20 verification recovery fee will be recovered from your first top-up — nothing to pay now."*

## 9. Admin controls (recommended)

All actions route through `crudAction()` so each writes `AuditLog` + `AdminAuditEvent` with a **reason** (satisfies "who approved a manual override").

| Control | Need | Build note |
|---|---|---|
| Create launch KYC campaign | **Yes** | New action + form; today batches are CLI-only. |
| Define campaign area | **Yes** | `LocationNode` reference (province/city/region/suburb level). |
| Define start & end date | **Yes** | `startsAt` (new) + `endsAt`. |
| Define max sponsored count | **Yes** | `maxSponsoredCount` (configurable, not hardcoded). |
| Pause / close campaign | **Yes** | `status: DRAFT/ACTIVE/PAUSED/CLOSED`. |
| Manually grant sponsorship | **Yes** | For approved-after-window or edge cases; role `TRUST`/`ADMIN`. |
| Manually revoke sponsorship | **Yes** | Writes `LAUNCH_KYC_VOUCHER_REVERSED`; restores allocation. |
| View campaign usage | **Yes** | granted / consumed / reversed / remaining. |
| Export campaign usage | **Yes** | CSV, like the existing voucher CSV export pattern. |
| See remaining allocation | **Yes** | `maxSponsoredCount − consumed (+ active reservations)`. |
| Vendor free-tier this month | **Yes (manual first)** | Admin-entered allowance + checks-used card; separate from campaign. |

Role mapping: campaign create/pause/close → `ADMIN`/`OWNER`; manual grant/revoke → `TRUST` (owns KYC) or `ADMIN`; usage view/export → `OPS`+. Gate the whole surface behind a new flag (e.g. `launch.kyc_campaign`), per house-rule #5.

## 10. Edge cases

| Case | Handling |
|---|---|
| Qualifies but **fails ID verification** | No grant (we grant on success). If a reservation model is used, **release** the slot (`…_REVERSED`). No fee sponsored; no allocation consumed. |
| Qualifies but **abandons onboarding** | No success → no grant. Reservation (if any) released on TTL. Allocation protected. |
| Qualifies but **outside launch area** | No active campaign matches → normal fee path. |
| **Changes address after** receiving the voucher | Sponsorship already consumed is **not clawed back** (the verified check was real). Future area-based eligibility re-evaluates on the new area only. |
| **Multiple service areas** | Qualifies if *any* area is in scope; sponsored **once** (dedup). |
| **Duplicate accounts** for repeated sponsorship | Dedup on **verified `identifierHash`** (ID number) across the campaign — one human ID = one sponsorship. Also phone uniqueness + `@@unique([providerId, campaignId])`. This is why grant-on-*verified*-identity is the safe trigger. |
| Already got a voucher from **another campaign** | Per-campaign dedup allows at most one per campaign; add a policy guard "one KYC sponsorship per identity across *all* campaigns" if desired (recommended). |
| Already has **wallet credits** | Irrelevant — KYC fee is rand, separate ledger. No interaction. |
| **Already paid** the KYC fee before campaign created | No retroactive sponsorship by default; admin may manually grant a `KYC_FEE_WAIVED`/refund if policy decides. |
| **Allocation runs out mid-onboarding** | Atomic decrement at grant: the transaction that would exceed the cap fails the allocation check and the provider falls to normal recovery. Show the "offer just ended" copy. |
| **Top-up happens before voucher applied** | Grant happens at KYC success, which gates top-up anyway (`kycStatus = VERIFIED` required to top up). Ordering: verify → (sponsor or accrue) → top-up. If a fee was accrued and *then* a manual sponsorship is granted, reverse the accrual (`…_REVERSED` + `KYC_FEE_SPONSORED`). |
| **Admin approves provider after campaign ends** | No auto-grant; admin may **manually grant** (audited) if intent was to include them. |
| **Vendor free allocation exhausted before campaign allocation** | Campaign continues (cap not reached) but checks now cost real money. Surface a **warning**, optionally an admin toggle "pause sponsorship when vendor free tier is exhausted". The two counters are independent. |
| Vendor gives 500 free but we only allocate 200 | `maxSponsoredCount = 200`; the other 300 free checks cover non-sponsored providers' vendor cost. Campaign cap ≠ vendor allowance. |
| **Roll over vs expire** unused allocation | Default **expire at `endsAt`**. Make rollover an explicit admin choice (raise `endsAt`/`maxSponsoredCount` on the next campaign) — avoid silent rollover. |
| Verified in one area, later applies in a **new launch area** | Sponsorship is once-per-identity; already-verified providers don't re-verify, so no second KYC fee arises — no double sponsorship needed. |

---

# Part 3 — Section 17: Launch KYC voucher / campaign discount recommendation

**17.1 Can the current system support automatic KYC sponsorship?**
Yes — the building blocks exist (lifecycle auto-grant with idempotent `@@unique`, atomic campaign dedup, `crudAction` audit, a clean transactional ledger, a mature KYC state machine with a webhook `PASSED` transition). What's missing is the **fee model**, the **fee/sponsorship ledger**, the **campaign entity**, and the **area scope** — all additive.

**17.2 Can vouchers be used for non-credit benefits (KYC fee sponsorship)?**
**Not as built.** `PromoVoucher` only adds integer credits and is redeemed by typing a code. KYC sponsorship is a **rand fee offset**, granted **automatically**. It needs a different model.

**17.3 Is a new campaign model needed?**
**Yes.** Build a small, purpose-made model rather than overloading the printed-flyer voucher:
- `KycCampaign` — `id`, `name`, `campaignCode @unique`, `locationNodeId` (area scope; null = global), `startsAt`, `endsAt`, `maxSponsoredCount`, `sponsoredCount` (cached), `status` (DRAFT/ACTIVE/PAUSED/CLOSED), `createdById`, timestamps.
- `KycSponsorship` — `id`, `campaignId`, `providerId`, `verificationId`, `identifierHash`, `status` (GRANTED/CONSUMED/REVERSED), `source` (SYSTEM/ADMIN), `grantedAt`, `consumedAt`, `revokedById`, `reason`. `@@unique([campaignId, providerId])` and a uniqueness guard on `identifierHash`.
- KYC-fee ledger reason codes (rand cents), kept **out of** the credit wallet.

**17.4 Where should the campaign threshold be stored?**
On `KycCampaign.maxSponsoredCount` — DB-backed, admin-editable, **never hardcoded**. The feature flag only toggles the surface on/off; the *number* lives on the campaign row.

**17.5 Should the sponsored count be by grants, attempts, successful verifications, or approvals?**
**Successful verifications** (one `CONSUMED` sponsorship / `KYC_FEE_SPONSORED` ledger row per provider), decremented atomically with the `kycStatus → VERIFIED` write. Most auditable, ties to a real identity and a real cost, and resists fraud.

**17.6 How to prevent abuse.**
Grant on **verified identity**, dedup on **`identifierHash`** (one human ID = one sponsorship), enforce `@@unique([campaignId, providerId])`, atomic allocation decrement (no oversubscription), and route all manual grants/revokes through `crudAction` (audited with actor + reason). Keep the existing redemption rate-limiting patterns for any provider-facing surface.

**17.7 How to show it in the provider wallet ledger.**
Merge the rand KYC-fee ledger into the wallet **history view** as read-only informational rows ("ID verification fee R20 — sponsored by launch campaign, R0 due"). Do **not** convert it to credits. Outstanding fee = `accrued − recovered − waived − sponsored`.

**17.8 How admin should monitor usage.**
A campaign detail screen: granted / consumed / reversed / remaining, plus CSV export, behind `launch.kyc_campaign`. A separate, initially-manual **vendor free-tier card** (allowance vs checks-used this month). Reconcile the system's sponsored/used counts against the Didit invoice monthly.

**17.9 How it interacts with the normal KYC fee-recovery model.**
The campaign is a **branch at the moment the fee would be booked.** On successful verification: if an active campaign matches the area and has allocation → `KYC_FEE_SPONSORED` (no recovery owed); else → `KYC_FEE_ACCRUED` and recover from first top-up (`FIRST_TOPUP_KYC_DEDUCTION`). This is **Option F**.

---

# Part 4 — Acceptance-criteria responses

- **Can current voucher logic support automatic launch KYC vouchers?** No, not directly — current vouchers are manual-redeem, credit-only, unscoped. The *patterns* (auto-grant idempotency, campaign dedup, audit, ledger) are reusable; the *tables* are not.
- **Reuse existing voucher tables or create a separate model?** **Create a separate `KycCampaign` + `KycSponsorship` model** plus rand KYC-fee ledger codes. Keep the printed-flyer voucher system untouched. Rationale: no manual code (requirement), fee ≠ credits, and missing area/count/date/status scoping.
- **How to count the first configurable N providers.** Count `CONSUMED` sponsorships (= `KYC_FEE_SPONSORED` rows) per campaign, decremented atomically at the `kycStatus → VERIFIED` transaction; cached `sponsoredCount` reconciled from the ledger.
- **Set the number per area, per campaign, or globally?** **Per campaign**, where a campaign is scoped to one launch area (and time window). Global is a campaign with no `locationNodeId`. The number is `maxSponsoredCount` on the campaign row.
- **Behaviour once allocation is exhausted.** Graceful fallback to the normal first-top-up recovery (Option F); admin can extend/pause/close. Atomic cap check prevents overspend.
- **How sponsored KYC appears in wallet history.** As merged rand informational rows in the wallet history view ("ID verification fee R20 — sponsored, R0 due"), never as credits.
- **Fraud / duplicate-account risks.** Duplicate accounts farming sponsored checks; mitigated by granting on verified identity and de-duplicating on `identifierHash`, plus per-campaign uniqueness and atomic caps.
- **Smallest safe MVP.** (1) `KycCampaign` + `KycSponsorship` tables; (2) four ledger reason codes (`KYC_FEE_ACCRUED`, `KYC_FEE_SPONSORED`, `KYC_FEE_RECOVERED`, `FIRST_TOPUP_KYC_DEDUCTION`) in a rand KYC-fee ledger; (3) an auto-grant hook on the KYC `PASSED` transition with an atomic allocation decrement and `identifierHash` dedup; (4) area match via `regionKey`/`serviceAreas`; (5) admin create/pause/close + usage screen behind `launch.kyc_campaign`; (6) provider "sponsored" copy on KYC + wallet; (7) vendor 500/month tracked as a manual admin number. Defer reservation/two-phase counting, waiver/revoke automation, CSV export, and systematised vendor-allocation tracking to a fast-follow.

---

## Appendix — key source references

- Voucher model & redemption: `prisma/schema.prisma:1419-1510`; `lib/voucher-redemption.ts`; `lib/vouchers.ts`; `lib/provider-wallet.ts:249`; `app/(admin)/admin/vouchers/*`; `scripts/generate-vouchers.ts`.
- Auto-grant (deactivated): `lib/provider-promo-awards.ts:17,96`; `lib/provider-auto-approve.ts:331-349`; `ProviderAutoApproveSideEffectMarker` `schema.prisma:1512`.
- Wallet ledger spine: `ProviderWallet`/`WalletLedgerEntry` `schema.prisma:1347,1365`; `WalletLedgerEntryType` `schema.prisma:2406`; `lib/provider-wallet.ts` (`createLedgerEntry`, idempotency, `$transaction`).
- KYC flow & vendors: `lib/identity-verification/orchestrator.ts` (state machine, `kycStatus` at `:535`); webhook `app/api/webhooks/verification/[vendor]/route.ts`; `lib/identity-verification/credit-gate.ts:68`; `VerificationVendorConfig` `schema.prisma:1207`; `ProviderIdentityVerification.identifierHash/costEstimateCents` `schema.prisma:1037,1060`.
- Vendor pricing / free tier: `lib/commercial/didit-pricing.ts:11`.
- Area model: `Provider.serviceAreas` `schema.prisma:217`; `TechnicianServiceArea` `schema.prisma:1576`; `LocationNode` `schema.prisma:172`; `lib/provider-record.ts:85`; `lib/launch/west-rand-pilot.ts`; `lib/customer-serviceability.ts:114,309`; `ServiceAreaWaitlist` `schema.prisma:150`.
- Admin/audit/config: `lib/crud-action.ts:133`; `setProviderKycAction` `app/(admin)/admin/providers/actions.ts:385`; `app/(admin)/admin/verifications/actions.ts`; `lib/flags.ts`; `lib/feature-flags-registry.ts`.
</content>
</invoke>
