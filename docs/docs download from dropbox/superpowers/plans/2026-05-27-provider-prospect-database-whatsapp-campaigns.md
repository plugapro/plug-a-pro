# Provider Prospect Database and WhatsApp Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a high-signal provider prospect database, make it visible and actionable in the admin ops dashboard, and support compliant WhatsApp outreach with opt-out handling.

**Architecture:** Add a separate prospecting bounded context instead of overloading `Provider` or `ProviderApplication`. Prospects move through sourcing, qualification, outreach, opt-out, and conversion; only consented/converted records enter the existing provider onboarding and identity-verification paths.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Supabase-backed admin auth, existing `crudAction`, existing `MessageEvent`, Meta WhatsApp Cloud API templates, Vitest, Prisma migrations.

---

## Current Anchors

- Admin nav source: `field-service/lib/admin-nav-routes.ts`
- Admin pages: `field-service/app/(admin)/admin/*`
- Admin mutation wrapper: `field-service/lib/crud-action.ts`
- Feature flags: `field-service/lib/feature-flags-registry.ts`
- Provider model: `field-service/prisma/schema.prisma`
- Existing customer WhatsApp marketing preference model: `Customer` and `WhatsappPreferenceLog`
- Existing WhatsApp inbound opt-out keywords: `field-service/lib/whatsapp-bot.ts`
- Existing outbound admin broadcast pattern: `field-service/app/(admin)/admin/messages/actions.ts`
- Existing message audit table: `MessageEvent`

## Compliance Baseline

- Do not scrape or import contacts without source evidence and a lawful-basis decision.
- Store `source`, `sourceUrl`, `sourceCapturedAt`, `lawfulBasis`, `consentStatus`, and `optedOutAt` on every prospect.
- WhatsApp provider recruitment campaigns must use approved template messages outside the 24-hour session window.
- Every campaign message must include opt-out wording, for example: `Reply STOP OFFERS to opt out.`
- Provider-prospect opt-outs must suppress future recruitment campaigns even if the same phone is re-imported later.
- Google Business Profile data must not be harvested via prohibited automated scraping. Use manual research, official APIs where permitted, partnerships, referrals, or explicit inbound consent.

## File Structure

Create:

- `field-service/lib/provider-prospects/types.ts` - enums/constants and query input types.
- `field-service/lib/provider-prospects/scoring.ts` - deterministic quality score and profile-fit score.
- `field-service/lib/provider-prospects/import.ts` - CSV row parser, normalization, duplicate handling.
- `field-service/lib/provider-prospects/campaigns.ts` - campaign eligibility, suppression, queueing, and conversion helpers.
- `field-service/app/(admin)/admin/provider-prospects/page.tsx` - ops dashboard list view.
- `field-service/app/(admin)/admin/provider-prospects/actions.ts` - admin CRUD, import, qualification, opt-out, and campaign queue actions.
- `field-service/app/(admin)/admin/provider-prospects/[id]/page.tsx` - prospect detail, outreach timeline, conversion CTA.
- `field-service/app/api/admin/provider-prospects/import/route.ts` - guarded CSV import endpoint if file uploads are needed.
- `field-service/__tests__/lib/provider-prospects-scoring.test.ts`
- `field-service/__tests__/lib/provider-prospects-import.test.ts`
- `field-service/__tests__/admin/provider-prospects-actions.test.ts`
- `field-service/__tests__/lib/provider-prospect-campaigns.test.ts`

Modify:

- `field-service/prisma/schema.prisma` - prospect/campaign tables and enums.
- `field-service/lib/admin-nav-routes.ts` - add `/admin/provider-prospects`.
- `field-service/lib/feature-flags-registry.ts` - add `admin.provider_prospects.v1` and `admin.provider_prospects.campaigns`.
- `field-service/lib/whatsapp-bot.ts` - route opt-out keywords to prospect suppression when no customer/provider exists or when a matching prospect exists.
- `field-service/app/(admin)/admin/messages/page.tsx` - include prospect campaign message filtering/metadata if needed.
- `field-service/lib/messaging-templates.ts` - add approved provider recruitment template key after Meta approval.

## Data Model

Add Prisma enums:

```prisma
enum ProviderProspectStatus {
  NEW
  QUALIFYING
  QUALIFIED
  CONTACTED
  INTERESTED
  NOT_A_FIT
  OPTED_OUT
  CONVERTED
  ARCHIVED
}

enum ProviderProspectSourceType {
  MANUAL_RESEARCH
  DIRECTORY
  PARTNER_REFERRAL
  PROVIDER_REFERRAL
  INBOUND
  IMPORT
}

enum ProviderProspectConsentStatus {
  UNKNOWN
  LEGITIMATE_INTEREST_REVIEWED
  OPTED_IN
  OPTED_OUT
  DO_NOT_CONTACT
}

enum ProviderProspectCampaignStatus {
  DRAFT
  READY
  QUEUED
  SENDING
  SENT
  PAUSED
  FAILED
  CANCELLED
}
```

Add Prisma models:

```prisma
model ProviderProspect {
  id                 String                        @id @default(cuid())
  businessName       String?
  contactName        String?
  phone              String
  normalizedPhone    String
  email              String?
  serviceCategories  String[]                      @default([])
  serviceAreas       String[]                      @default([])
  sourceType         ProviderProspectSourceType
  sourceName         String
  sourceUrl          String?
  sourceCapturedAt   DateTime                      @default(now())
  lawfulBasis        String?
  evidence           Json                          @default("{}")
  qualityScore       Int                           @default(0)
  profileFitScore    Int                           @default(0)
  status             ProviderProspectStatus        @default(NEW)
  consentStatus      ProviderProspectConsentStatus @default(UNKNOWN)
  optedOutAt         DateTime?
  optedOutSource     String?
  lastContactedAt    DateTime?
  nextFollowUpAt     DateTime?
  convertedProviderId String?
  convertedApplicationId String?
  ownerAdminId       String?
  notes              String?
  createdAt          DateTime                      @default(now())
  updatedAt          DateTime                      @updatedAt

  outreachEvents     ProviderProspectOutreachEvent[]

  @@unique([normalizedPhone])
  @@index([status, createdAt])
  @@index([consentStatus, status])
  @@index([profileFitScore, qualityScore])
  @@map("provider_prospects")
}

model ProviderProspectOutreachCampaign {
  id             String                         @id @default(cuid())
  name           String
  templateKey    String
  status         ProviderProspectCampaignStatus @default(DRAFT)
  filters        Json                           @default("{}")
  maxRecipients  Int                            @default(50)
  queuedCount    Int                            @default(0)
  sentCount      Int                            @default(0)
  failedCount    Int                            @default(0)
  createdById    String
  createdAt      DateTime                       @default(now())
  updatedAt      DateTime                       @updatedAt

  events         ProviderProspectOutreachEvent[]

  @@index([status, createdAt])
  @@map("provider_prospect_outreach_campaigns")
}

model ProviderProspectOutreachEvent {
  id              String   @id @default(cuid())
  prospectId      String
  campaignId      String?
  messageEventId  String?
  channel         String
  action          String
  status          String
  templateKey     String?
  bodyPreview     String?
  failureReason   String?
  metadata        Json     @default("{}")
  createdById     String?
  createdAt       DateTime @default(now())

  prospect ProviderProspect @relation(fields: [prospectId], references: [id], onDelete: Cascade)
  campaign ProviderProspectOutreachCampaign? @relation(fields: [campaignId], references: [id])

  @@index([prospectId, createdAt])
  @@index([campaignId, createdAt])
  @@map("provider_prospect_outreach_events")
}
```

## Task 1: Schema and Flags

**Files:**
- Modify: `field-service/prisma/schema.prisma`
- Modify: `field-service/lib/feature-flags-registry.ts`
- Test: generated Prisma client/typecheck

- [ ] Add the enums and models from the `Data Model` section to `schema.prisma`.
- [ ] Add these flags to `FEATURE_FLAGS_REGISTRY`:

```ts
'admin.provider_prospects.v1': {
  description: 'Enable provider prospect database admin views and non-campaign mutations.',
  owner: 'ops',
  defaultValue: false,
},
'admin.provider_prospects.campaigns': {
  description: 'Enable provider prospect WhatsApp campaign queueing and sends.',
  owner: 'ops',
  defaultValue: false,
},
```

- [ ] Run:

```bash
cd field-service
pnpm prisma migrate dev --name provider_prospect_database
pnpm db:generate
pnpm typecheck
```

- [ ] Expected: Prisma client regenerates, migration is created, typecheck passes.

## Task 2: Prospect Scoring

**Files:**
- Create: `field-service/lib/provider-prospects/types.ts`
- Create: `field-service/lib/provider-prospects/scoring.ts`
- Test: `field-service/__tests__/lib/provider-prospects-scoring.test.ts`

- [ ] Write tests for:
  - service category match adds score.
  - target area match adds score.
  - source evidence adds score.
  - missing phone or opt-out returns ineligible.
  - score is capped at 100.

- [ ] Implement deterministic scoring:

```ts
export function scoreProviderProspect(input: {
  serviceCategories: string[]
  serviceAreas: string[]
  evidence: Record<string, unknown>
  consentStatus: string
  optedOutAt?: Date | null
}) {
  if (input.optedOutAt || input.consentStatus === 'OPTED_OUT' || input.consentStatus === 'DO_NOT_CONTACT') {
    return { qualityScore: 0, profileFitScore: 0, campaignEligible: false }
  }

  const categoryScore = Math.min(input.serviceCategories.length * 15, 45)
  const areaScore = Math.min(input.serviceAreas.length * 10, 30)
  const evidenceScore = Object.keys(input.evidence ?? {}).length > 0 ? 15 : 0
  const consentScore = input.consentStatus === 'OPTED_IN' ? 10 : 0
  const total = Math.min(categoryScore + areaScore + evidenceScore + consentScore, 100)

  return {
    qualityScore: Math.min(evidenceScore + consentScore + 50, 100),
    profileFitScore: total,
    campaignEligible: total >= 45,
  }
}
```

- [ ] Run:

```bash
cd field-service
pnpm exec vitest run __tests__/lib/provider-prospects-scoring.test.ts
```

## Task 3: CSV Import and Deduplication

**Files:**
- Create: `field-service/lib/provider-prospects/import.ts`
- Test: `field-service/__tests__/lib/provider-prospects-import.test.ts`

- [ ] Support CSV columns:
  - `businessName`
  - `contactName`
  - `phone`
  - `email`
  - `serviceCategories`
  - `serviceAreas`
  - `sourceType`
  - `sourceName`
  - `sourceUrl`
  - `lawfulBasis`
  - `notes`

- [ ] Normalize phone to E.164 where possible and reject rows without a usable phone.
- [ ] Upsert by `normalizedPhone`.
- [ ] Preserve opt-outs on re-import: never overwrite `OPTED_OUT` or `DO_NOT_CONTACT`.
- [ ] Write tests for duplicate import, opt-out preservation, invalid phone rejection, and score recomputation.

## Task 4: Admin List and Detail Views

**Files:**
- Modify: `field-service/lib/admin-nav-routes.ts`
- Create: `field-service/app/(admin)/admin/provider-prospects/page.tsx`
- Create: `field-service/app/(admin)/admin/provider-prospects/[id]/page.tsx`
- Create: `field-service/app/(admin)/admin/provider-prospects/actions.ts`
- Test: `field-service/__tests__/admin/provider-prospects-actions.test.ts`
- Test: `field-service/__tests__/lib/admin-nav-routes.test.ts`

- [ ] Add nav item:

```ts
{ href: '/admin/provider-prospects', label: 'Prospects', icon: 'users' as const },
```

- [ ] List page filters:
  - search
  - status
  - source type
  - consent status
  - category
  - area
  - minimum profile-fit score
  - contacted/uncontacted

- [ ] Detail page sections:
  - source and evidence
  - qualification score
  - service categories and areas
  - consent/opt-out state
  - outreach timeline
  - admin notes
  - actions: qualify, mark not fit, opt out, archive, convert to provider application

- [ ] Mutations must use `crudAction` with `requiredRole: ['OPS', 'ADMIN', 'OWNER']` for normal edits and `requiredRole: ['ADMIN', 'OWNER']` for import/bulk/campaign actions.
- [ ] All mutations require `admin.provider_prospects.v1`.

## Task 5: WhatsApp Campaign Queue

**Files:**
- Create: `field-service/lib/provider-prospects/campaigns.ts`
- Modify: `field-service/lib/messaging-templates.ts`
- Modify: `field-service/app/(admin)/admin/provider-prospects/actions.ts`
- Test: `field-service/__tests__/lib/provider-prospect-campaigns.test.ts`

- [ ] Add a template key only after Meta template approval, for example `provider_recruitment_invite_v1`.
- [ ] Campaign eligibility must require:
  - `status` in `QUALIFIED` or `CONTACTED`
  - `consentStatus` not in `OPTED_OUT` or `DO_NOT_CONTACT`
  - `optedOutAt` is null
  - `normalizedPhone` present
  - no successful campaign message for same template in the last 30 days
  - `profileFitScore >= configured threshold`

- [ ] Queue messages into `MessageEvent` with metadata:

```ts
{
  providerProspectId,
  providerProspectCampaignId,
  recruitmentCampaign: true,
  optOutInstruction: 'Reply STOP OFFERS to opt out',
}
```

- [ ] Use idempotency key:

```ts
`provider-prospect-campaign:${campaignId}:${prospectId}:${templateKey}`
```

- [ ] Campaign queueing must create a `ProviderProspectOutreachEvent` for every queued, skipped, and failed candidate.
- [ ] The first version may queue only; sending can reuse the existing outbound worker/pipeline if present. If no worker exists, add a narrow sender in a later task rather than sending inside the transaction.

## Task 6: Opt-Out Handling

**Files:**
- Modify: `field-service/lib/whatsapp-bot.ts`
- Create or modify: `field-service/lib/provider-prospects/campaigns.ts`
- Test: `field-service/__tests__/lib/provider-prospect-campaigns.test.ts`

- [ ] Extend opt-out behavior so STOP phrases update matching prospects by normalized phone:
  - set `consentStatus = OPTED_OUT`
  - set `status = OPTED_OUT`
  - set `optedOutAt = now`
  - set `optedOutSource = 'whatsapp_bot'`
  - create `ProviderProspectOutreachEvent` with `action = 'opt_out'`

- [ ] Keep existing customer opt-out behavior intact.
- [ ] If one phone exists as both customer and prospect, update both preference systems.
- [ ] Tests must prove a prospect who opts out is not selected by later campaign queueing.

## Task 7: Conversion to Provider Application

**Files:**
- Modify: `field-service/app/(admin)/admin/provider-prospects/actions.ts`
- Test: `field-service/__tests__/admin/provider-prospects-actions.test.ts`

- [ ] Add `convertProspectToApplicationAction`.
- [ ] Create `ProviderApplication` with:
  - `phone`
  - `email`
  - `name` from `contactName || businessName || phone`
  - `skills` from `serviceCategories`
  - `serviceAreas`
  - `evidenceNote` summarizing source and admin qualification
  - `status = PENDING`
- [ ] Mark prospect `CONVERTED`, set `convertedApplicationId`, and preserve source/evidence in outreach event metadata.
- [ ] Do not create a `Provider` until the existing application approval flow approves the application.

## Task 8: Dashboard Metrics

**Files:**
- Modify: `field-service/app/(admin)/admin/page.tsx`
- Create or modify: `field-service/app/(admin)/admin/provider-prospects/page.tsx`

- [ ] Add an admin dashboard tile:
  - total prospects
  - qualified prospects
  - opted-out prospects
  - interested prospects
  - converted prospects
  - coverage gaps by category/area

- [ ] Link the tile to `/admin/provider-prospects?status=QUALIFIED`.
- [ ] Keep the list mobile-readable but optimized for desktop ops use.

## Task 9: Validation

Run focused tests first:

```bash
cd field-service
pnpm exec vitest run \
  __tests__/lib/provider-prospects-scoring.test.ts \
  __tests__/lib/provider-prospects-import.test.ts \
  __tests__/lib/provider-prospect-campaigns.test.ts \
  __tests__/admin/provider-prospects-actions.test.ts \
  __tests__/lib/admin-nav-routes.test.ts
```

Then full validation:

```bash
cd field-service
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected result: all commands pass, no raw phone/source evidence is logged in test output, and admin route smoke coverage includes `/admin/provider-prospects`.

## Rollout

1. Ship schema, scoring, import, and read-only admin view behind `admin.provider_prospects.v1`.
2. Import 50-100 manually qualified prospects from one city and three categories.
3. Verify filters, scoring, dedupe, and opt-out state in admin.
4. Submit Meta template for `provider_recruitment_invite_v1`.
5. Enable `admin.provider_prospects.campaigns` in staging.
6. Queue a test campaign to internal test numbers only.
7. Verify `MessageEvent`, `ProviderProspectOutreachEvent`, and WhatsApp opt-out handling.
8. Enable production campaign flag with `maxRecipients` capped at 50.
9. Review conversion rate before expanding sources.

## Acceptance Criteria

- Ops can import and manually add prospects without creating real providers.
- Ops can filter prospects by score, category, area, source, status, and consent state.
- Ops can see campaign history and opt-out state from the prospect detail page.
- Campaign queueing excludes opted-out and do-not-contact prospects.
- Inbound opt-out replies suppress future recruitment outreach.
- Conversion creates a normal `ProviderApplication` and reuses the existing admin review/KYC path.
- Existing provider/customer WhatsApp flows continue passing tests.

## Self-Review

- Scope is one bounded feature: provider prospecting and recruitment outreach.
- Payment, wallet, matching, and provider lead acceptance internals are out of scope.
- Existing provider KYC remains the high-assurance boundary after conversion.
- Existing customer marketing preferences are not reused for prospects because prospects may not be customers.
- The plan uses feature flags for read/write and campaign rollout separation.
- The plan keeps campaign sends audited through `MessageEvent` and prospect-specific outreach events.
