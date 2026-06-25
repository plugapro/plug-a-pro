# Sprint 4-6 Identity Verification And Qualified Shortlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Sprint 4-6 by enforcing identity verification at every credit-backed provider action while preserving the qualified shortlist journey: safe previews, free interest capture, customer selection, selected-provider acceptance, one-credit debit, and full detail unlock.

**Architecture:** Keep the server-side identity/credit gate as the enforcement source of truth and layer UX gates in front of it for WhatsApp and PWA. The qualified shortlist flow remains additive: providers can express interest for free, customers select from a safe shortlist, and only the selected provider spends one credit after identity verification passes.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Vitest, WhatsApp interactive messages, Plug A Pro provider wallet ledger, feature flags via `lib/flags.ts`.

---

## Source Map

- `field-service/lib/identity-verification/credit-gate.ts`: shared predicate for paid-credit eligibility and throwing enforcement.
- `field-service/app/(provider)/provider/credits/actions.ts`: provider wallet loader, locked-state surface, verification-link action.
- `field-service/components/provider/credits/index.tsx`: PWA credits-page locked CTA UI.
- `field-service/lib/whatsapp-flows/provider-journey.ts`: WhatsApp provider top-up menu precheck.
- `field-service/lib/selected-provider-acceptance.ts`: final selected-provider acceptance, credit check/debit, accepted lock.
- `field-service/lib/matching-engine.ts`: compatibility wrapper used by signed links, API paths, and legacy lead accept paths.
- `field-service/lib/whatsapp-bot.ts`: stateless `confirm_accept:<leadId>` selected-provider action handling.
- `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`: authenticated provider PWA lead accept response UI.
- `field-service/app/leads/access/[token]/page.tsx`: signed provider lead access accept response UI.
- `field-service/__tests__/lib/identity-verification/credit-gate.test.ts`: enforcement predicate coverage.
- `field-service/__tests__/lib/identity-verification-credit-eligibility.test.ts`: flag-on/flag-off eligibility coverage.
- `field-service/__tests__/provider/provider-credits-actions.test.ts`: provider wallet locked-state and verification-link action coverage.
- `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts`: WhatsApp top-up precheck coverage.
- `field-service/__tests__/lib/selected-provider-acceptance.test.ts`: selected-provider final acceptance unit coverage.
- `field-service/__tests__/lib/matching-engine.test.ts`: compatibility-wrapper result mapping.
- `field-service/__tests__/lib/whatsapp-bot-stateless.test.ts`: WhatsApp stateless button handling.
- `field-service/__tests__/integration/cross-channel-release-harness.test.ts`: journey release harness.

---

### Task 1: Establish Baseline And Worktree

**Files:**
- Read: `AGENTS.md`
- Read: `field-service/package.json`
- Read: `field-service/lib/identity-verification/credit-gate.ts`
- Read: `field-service/lib/selected-provider-acceptance.ts`
- Read: `field-service/lib/whatsapp-bot.ts`

- [ ] **Step 1: Create an isolated worktree**

```bash
git fetch origin
git worktree add .worktrees/sprint-4-6-identity-shortlist -b codex/sprint-4-6-identity-shortlist origin/main
cd .worktrees/sprint-4-6-identity-shortlist/field-service
pnpm install
pnpm db:generate
```

Expected: Prisma client generates successfully.

- [ ] **Step 2: Run baseline focused tests**

```bash
pnpm exec vitest run \
  __tests__/lib/selected-provider-acceptance.test.ts \
  __tests__/lib/provider-acceptance-credit-unlock.test.ts \
  __tests__/lib/provider-whatsapp-interest-flow.test.ts
```

Expected: tests pass before implementation. If Prisma client is missing, run `pnpm db:generate` and rerun.

- [ ] **Step 3: Commit no code**

Do not commit setup-only work. Continue only after the baseline is known.

---

### Task 2: Tighten The Shared Credit Identity Predicate

**Files:**
- Modify: `field-service/lib/identity-verification/credit-gate.ts`
- Test: `field-service/__tests__/lib/identity-verification/credit-gate.test.ts`
- Test: `field-service/__tests__/lib/identity-verification-credit-eligibility.test.ts`

- [ ] **Step 1: Write failing enforcement tests**

Add this test to `field-service/__tests__/lib/identity-verification/credit-gate.test.ts`:

```ts
it('blocks providers whose coarse KYC status is not verified even with high-assurance verification', async () => {
  const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
  mockProviderFindUnique.mockResolvedValue({ kycStatus: 'SUBMITTED' })
  mockFindFirst.mockResolvedValue({ id: 'ver-1', providerId: 'provider-1' })

  await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
    code: 'IDENTITY_NOT_VERIFIED',
  })
  expect(mockFindFirst).not.toHaveBeenCalled()
})
```

Update the transaction-client test so the injected client includes `provider.findUnique`:

```ts
const txProviderFindUnique = vi.fn().mockResolvedValue({ kycStatus: 'VERIFIED' })

await expect(
  assertIdentityVerifiedForCredits('provider-1', {
    provider: { findUnique: txProviderFindUnique },
    providerIdentityVerification: { findFirst: txFindFirst },
  }),
).resolves.toEqual({
  providerId: 'provider-1',
  verificationId: 'ver-tx',
})
```

- [ ] **Step 2: Run tests and verify red**

```bash
pnpm exec vitest run __tests__/lib/identity-verification/credit-gate.test.ts
```

Expected: the new coarse-KYC enforcement test fails because `assertIdentityVerifiedForCredits` does not yet query provider KYC.

- [ ] **Step 3: Implement the shared predicate**

In `field-service/lib/identity-verification/credit-gate.ts`, make `IdentityVerificationLookupClient` require both `provider.findUnique` and `providerIdentityVerification.findFirst`, then add:

```ts
async function findEligibleCreditIdentity(
  providerId: string,
  client: IdentityVerificationLookupClient,
): Promise<{ providerId: string; verificationId: string } | null> {
  const provider = await client.provider.findUnique({
    where: { id: providerId },
    select: { kycStatus: true },
  })

  if (!provider || provider.kycStatus !== KycStatus.VERIFIED) {
    return null
  }

  const verification = await client.providerIdentityVerification.findFirst({
    where: buildHighAssuranceCreditVerificationWhere(providerId),
    orderBy: { updatedAt: 'desc' },
    select: { id: true, providerId: true },
  })

  if (!verification) {
    return null
  }

  return { providerId, verificationId: verification.id }
}
```

Use it from both gates:

```ts
const eligibleIdentity = await findEligibleCreditIdentity(providerId, client)

if (!eligibleIdentity) {
  throw new IdentityCreditGateError()
}

return eligibleIdentity
```

```ts
return Boolean(await findEligibleCreditIdentity(providerId, client))
```

- [ ] **Step 4: Run identity tests**

```bash
pnpm exec vitest run \
  __tests__/lib/identity-verification/credit-gate.test.ts \
  __tests__/lib/identity-verification-credit-eligibility.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/identity-verification/credit-gate.ts \
  field-service/__tests__/lib/identity-verification/credit-gate.test.ts \
  field-service/__tests__/lib/identity-verification-credit-eligibility.test.ts
git commit -m "fix(identity): align paid credit verification gate"
```

---

### Task 3: Gate Credit Acquisition Up Front In PWA And WhatsApp

**Files:**
- Modify: `field-service/app/(provider)/provider/credits/actions.ts`
- Modify: `field-service/components/provider/credits/index.tsx`
- Modify: `field-service/lib/whatsapp-flows/provider-journey.ts`
- Test: `field-service/__tests__/provider/provider-credits-actions.test.ts`
- Test: `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts`

- [ ] **Step 1: Add wallet locked-state tests**

In `field-service/__tests__/provider/provider-credits-actions.test.ts`, assert locked and unlocked states:

```ts
const { isProviderEligibleForCredits } = await import('../../lib/identity-verification/credit-gate')
;(isProviderEligibleForCredits as any).mockResolvedValue(false)

const { getProviderWallet } = await import('../../app/(provider)/provider/credits/actions')
const wallet = await getProviderWallet()

expect(wallet.creditPurchaseLocked).toBe(true)
expect(isProviderEligibleForCredits).toHaveBeenCalledWith('provider-1')
```

```ts
;(isProviderEligibleForCredits as any).mockResolvedValue(true)

const wallet = await getProviderWallet()

expect(wallet.creditPurchaseLocked).toBe(false)
expect(isProviderEligibleForCredits).toHaveBeenCalledWith('provider-1')
```

- [ ] **Step 2: Implement PWA wallet lock surface**

In `field-service/app/(provider)/provider/credits/actions.ts`, keep:

```ts
creditPurchaseLocked: boolean
```

Load eligibility in `getProviderWallet()`:

```ts
const [
  balance,
  ledgerEntries,
  pendingIntents,
  eligible,
] = await Promise.all([
  getProviderWalletBalance(provider.id),
  getProviderWalletLedgerEntries(provider.id, { limit: 10 }),
  getProviderPendingIntentsForProvider(provider.id),
  isProviderEligibleForCredits(provider.id),
])

const creditPurchaseLocked = !eligible
```

Expose verification link issuance:

```ts
export async function requestCreditVerificationUrl(): Promise<{ url: string | null }> {
  const provider = await getAuthenticatedProvider()
  const url = await issueCreditVerificationUrl(provider.id)
  return { url }
}
```

- [ ] **Step 3: Implement PWA CTA card**

In `field-service/components/provider/credits/index.tsx`, replace package rows with a single card when `wallet.creditPurchaseLocked` is true. The action should call:

```ts
const { url } = await requestCreditVerificationUrl()
if (url) {
  window.location.assign(url)
  return
}
toast.error('We could not start identity verification. Please try again.')
```

Required copy:

```text
ID verification needed
Verify your identity to unlock credit top-ups. Takes ~2 min. Required once.
Verify my ID
~2 min, required once
```

- [ ] **Step 4: Add WhatsApp top-up precheck test**

In `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts`, mock eligibility false and assert CTA rather than amount list:

```ts
;(isProviderEligibleForCredits as ReturnType<typeof vi.fn>).mockResolvedValue(false)

await handleProviderJourneyFlow({
  phone: PHONE,
  reply: { id: 'provider_top_up_credits', type: 'button' },
  conversation,
})

expect(isProviderEligibleForCredits).toHaveBeenCalledWith('prov_1')
expect(sendList).not.toHaveBeenCalled()
expect(sendCtaUrl).toHaveBeenCalledWith(
  PHONE,
  expect.stringContaining('Identity check required'),
  'Verify identity',
  'https://app.plugapro.co.za/provider/verify/token-1',
)
```

- [ ] **Step 5: Implement WhatsApp top-up precheck**

In `field-service/lib/whatsapp-flows/provider-journey.ts`, before sending the top-up amount list:

```ts
const eligible = await isProviderEligibleForCredits(provider.id)
if (!eligible) {
  const verificationUrl =
    (await issueIdentityVerificationLinkForWhatsApp(provider.id)) ??
    getPublicAppUrl('/provider/verification')

  await sendCtaUrl(
    phone,
    'ID verification is required before topping up credits.',
    ctaLabelFor('identity_verification'),
    verificationUrl,
  )
  return { nextStep: 'done' }
}
```

Keep the post-create `IDENTITY_NOT_VERIFIED` catch as the backstop for direct button replies.

- [ ] **Step 6: Run tests**

```bash
pnpm exec vitest run \
  __tests__/provider/provider-credits-actions.test.ts \
  __tests__/lib/whatsapp-flows/provider-journey.test.ts
```

Expected: both files pass.

- [ ] **Step 7: Commit**

```bash
git add field-service/app/\(provider\)/provider/credits/actions.ts \
  field-service/components/provider/credits/index.tsx \
  field-service/lib/whatsapp-flows/provider-journey.ts \
  field-service/__tests__/provider/provider-credits-actions.test.ts \
  field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts
git commit -m "feat(credits): gate top ups before provider action"
```

---

### Task 4: Gate Selected-Provider Final Acceptance Before Credit Mutation

**Files:**
- Modify: `field-service/lib/selected-provider-acceptance.ts`
- Test: `field-service/__tests__/lib/selected-provider-acceptance.test.ts`

- [ ] **Step 1: Write failing no-mutation test**

Add a mock for `assertIdentityVerifiedForCredits` and this test:

```ts
it('blocks selected-provider final acceptance before credit checks when identity is not verified', async () => {
  mockAssertIdentityVerifiedForCredits.mockRejectedValueOnce(new MockIdentityCreditGateError())

  const result = await acceptSelectedProviderJob({
    leadId: 'lead-1',
    providerId: 'provider-1',
    source: 'whatsapp',
  })

  expect(result).toEqual({ ok: false, reason: 'IDENTITY_NOT_VERIFIED' })
  expect(mockAssertIdentityVerifiedForCredits).toHaveBeenCalledWith('provider-1', state.tx)
  expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
  expect(state.tx.auditLog.create).not.toHaveBeenCalled()
  expect(state.tx.providerWallet.findUnique).not.toHaveBeenCalled()
  expect(mockApplyProviderCredit).not.toHaveBeenCalled()
  expect(mockLockAcceptedLead).not.toHaveBeenCalled()
  expect(mockNotifyAcceptedLeadLocked).not.toHaveBeenCalled()
  expect(state.lead.status).toBe('CUSTOMER_SELECTED')
})
```

- [ ] **Step 2: Run test and verify red**

```bash
pnpm exec vitest run __tests__/lib/selected-provider-acceptance.test.ts
```

Expected: the new test fails because acceptance still proceeds to credit check/debit.

- [ ] **Step 3: Implement selected-provider identity gate**

In `field-service/lib/selected-provider-acceptance.ts`, add `IDENTITY_NOT_VERIFIED` to the false reason union and import:

```ts
import {
  IdentityCreditGateError,
  assertIdentityVerifiedForCredits,
} from './identity-verification/credit-gate'
```

After request/lead/provider/expiry/status validation, before changing `CUSTOMER_SELECTED` to `PROVIDER_ACCEPTED`, add:

```ts
try {
  await assertIdentityVerifiedForCredits(params.providerId, tx)
} catch (error) {
  if (error instanceof IdentityCreditGateError) {
    return { ok: false as const, reason: 'IDENTITY_NOT_VERIFIED' as const }
  }
  throw error
}
```

Also catch leaked identity-gate errors outside the transaction:

```ts
if (error instanceof IdentityCreditGateError) {
  return { ok: false, reason: 'IDENTITY_NOT_VERIFIED' }
}
```

- [ ] **Step 4: Run selected-provider tests**

```bash
pnpm exec vitest run __tests__/lib/selected-provider-acceptance.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/selected-provider-acceptance.ts \
  field-service/__tests__/lib/selected-provider-acceptance.test.ts
git commit -m "fix(shortlist): require identity before selected acceptance"
```

---

### Task 5: Align WhatsApp, PWA, Signed Link, And Compatibility Accept Paths

**Files:**
- Modify: `field-service/lib/whatsapp-bot.ts`
- Modify: `field-service/lib/matching-engine.ts`
- Modify: `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`
- Modify: `field-service/app/leads/access/[token]/page.tsx`
- Test: `field-service/__tests__/lib/whatsapp-bot-stateless.test.ts`
- Test: `field-service/__tests__/lib/matching-engine.test.ts`

- [ ] **Step 1: Add WhatsApp CTA test**

In `field-service/__tests__/lib/whatsapp-bot-stateless.test.ts`:

```ts
it('sends identity verification CTA when IDENTITY_NOT_VERIFIED blocks confirm_accept', async () => {
  mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
  mockAcceptSelectedProviderJob.mockResolvedValue({
    ok: false,
    reason: 'IDENTITY_NOT_VERIFIED',
  })

  await processInboundMessage(buttonMessage('confirm_accept:lead-idv-1'))

  expect(mockIssueVerificationLink).toHaveBeenCalledWith({
    providerId: 'provider-1',
    channel: 'WHATSAPP',
  })
  expect(mockSendCtaUrl).toHaveBeenCalledWith(
    PHONE,
    expect.stringContaining('Identity check required'),
    'Verify identity',
    'https://app.plugapro.co.za/provider/verify/token-1',
  )
  expect(mockSendText).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('Not enough credits'))
  expect(mockSendJourneyRecovery).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Implement WhatsApp selected-provider CTA**

In `field-service/lib/whatsapp-bot.ts`, in the `!result.ok` branch for `confirm_accept:<leadId>`:

```ts
if (result.reason === 'IDENTITY_NOT_VERIFIED') {
  let verificationUrl = getPublicAppUrl('/provider/verification')
  try {
    const { issueProviderIdentityVerificationLink } = await import('./identity-verification/link')
    const verificationLink = await issueProviderIdentityVerificationLink({
      providerId: provider.id,
      channel: 'WHATSAPP',
    })
    verificationUrl = verificationLink.verificationUrl ?? verificationUrl
  } catch (linkError) {
    console.error('[whatsapp-bot] selected-provider identity verification link issue failed', {
      traceId,
      leadId,
      providerId: provider.id,
      error: linkError instanceof Error ? linkError.message : String(linkError),
    })
  }

  const body =
    'Identity check required\n\n' +
    'Please verify your identity before accepting this selected job. No credit was deducted and the customer details remain locked.'

  if (verificationUrl) {
    await sendCtaUrl(phone, body, ctaLabelFor('identity_verification'), verificationUrl)
  } else {
    await sendText(phone, `${body}\n\nReply *verify identity* to continue.`)
  }
  return
}
```

- [ ] **Step 3: Add compatibility-wrapper test**

In `field-service/__tests__/lib/matching-engine.test.ts`:

```ts
it('acceptLead preserves identity-verification blocks from selected-provider acceptance', async () => {
  mockDb.lead.findUnique.mockResolvedValue({
    id: 'lead-1',
    customerSelectedAt: new Date('2026-05-10T08:00:00.000Z'),
    jobRequest: {
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
    },
  })
  mockAcceptSelectedProviderJob.mockResolvedValue({
    ok: false,
    reason: 'IDENTITY_NOT_VERIFIED',
  })

  const result = await acceptLead({ leadId: 'lead-1', providerId: 'provider-1', source: 'pwa' })

  expect(result).toEqual({
    ok: false,
    reason: 'IDENTITY_NOT_VERIFIED',
  })
  expect(mockAcceptAssignmentOffer).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: Preserve identity error through `acceptLead`**

In `field-service/lib/matching-engine.ts`, add the reason to `LeadRejected`:

```ts
| 'IDENTITY_NOT_VERIFIED'
```

Map the selected-provider result:

```ts
if (selectedResult.reason === 'IDENTITY_NOT_VERIFIED') {
  return { ok: false, reason: 'IDENTITY_NOT_VERIFIED' }
}
```

- [ ] **Step 5: Add PWA and signed-link identity messages**

In `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`, redirect:

```ts
if (result.reason === 'IDENTITY_NOT_VERIFIED') {
  redirect(`/provider/leads/${leadId}?acceptError=identity`)
}
```

Render:

```tsx
{resolvedSearchParams.acceptError === 'identity' && (
  <AlertCallout
    tone="warning"
    action={
      <Button asChild size="sm" variant="outline">
        <Link href="/provider/verification">Verify identity</Link>
      </Button>
    }
  >
    Verify your identity before accepting this selected job. Customer direct contact details remain locked and no credit was deducted.
  </AlertCallout>
)}
```

In `field-service/app/leads/access/[token]/page.tsx`, map and render:

```ts
case 'IDENTITY_NOT_VERIFIED':
  return 'IDENTITY_NOT_VERIFIED'
```

```ts
if (result.reason === 'IDENTITY_NOT_VERIFIED') {
  redirectLeadActionError(token, {
    error: 'identity',
    errorCode: 'IDENTITY_NOT_VERIFIED',
    action: 'accept',
    traceId,
    message: 'Verify your identity before accepting this selected job.',
    creditDeducted: false,
  })
}
```

```tsx
{resolvedSearchParams.error === 'identity' && (
  <div className="tone-warning rounded-lg border px-4 py-3 text-sm">
    <p className="font-medium">Identity verification is needed before accepting this selected job.</p>
    <p className="mt-1">No credit was deducted and customer contact details remain hidden.</p>
    <Button asChild size="sm" variant="outline" className="mt-3">
      <Link href="/provider/verification">Verify identity</Link>
    </Button>
    <p className="mt-2 text-xs">
      Error code: IDENTITY_NOT_VERIFIED
      {resolvedSearchParams.actionTraceId ? ` · Trace ID: ${resolvedSearchParams.actionTraceId}` : ''}
    </p>
  </div>
)}
```

- [ ] **Step 6: Run affected tests**

```bash
pnpm exec vitest run \
  __tests__/lib/matching-engine.test.ts \
  __tests__/lib/whatsapp-bot-stateless.test.ts \
  __tests__/lib/selected-provider-acceptance.test.ts \
  __tests__/lib/identity-verification/credit-gate.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add field-service/lib/whatsapp-bot.ts \
  field-service/lib/matching-engine.ts \
  field-service/app/\(provider\)/provider/leads/\[leadId\]/page.tsx \
  field-service/app/leads/access/\[token\]/page.tsx \
  field-service/__tests__/lib/whatsapp-bot-stateless.test.ts \
  field-service/__tests__/lib/matching-engine.test.ts
git commit -m "fix(shortlist): surface identity verification accept blocks"
```

---

### Task 6: Prove Qualified Shortlist Journey Still Holds

**Files:**
- Read: `field-service/lib/matching/dispatch.ts`
- Read: `field-service/lib/provider-opportunity-responses.ts`
- Read: `field-service/lib/customer-shortlists.ts`
- Read: `field-service/lib/selected-provider-acceptance.ts`
- Test: `field-service/__tests__/lib/provider-whatsapp-interest-flow.test.ts`
- Test: `field-service/__tests__/lib/customer-shortlists.test.ts`
- Test: `field-service/__tests__/integration/cross-channel-release-harness.test.ts`

- [ ] **Step 1: Verify safe preview dispatch stays free**

```bash
pnpm exec vitest run __tests__/lib/provider-whatsapp-interest-flow.test.ts
```

Expected: provider interest capture passes without wallet debit or full customer-detail unlock.

- [ ] **Step 2: Verify shortlist creation and customer selection**

```bash
pnpm exec vitest run __tests__/lib/customer-shortlists.test.ts
```

Expected: customer shortlist selection emits `confirm_accept:<leadId>` / `confirm_decline:<leadId>` for the selected provider and does not reveal full customer contact details to non-selected providers.

- [ ] **Step 3: Verify cross-channel harness**

```bash
pnpm e2e
```

Expected:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

- [ ] **Step 4: Record any missing journey coverage**

If the harness does not include an identity-blocked selected-provider case, add a new assertion to `field-service/__tests__/integration/cross-channel-release-harness.test.ts` that proves:

```ts
expect(finalAcceptance.result).toEqual({
  ok: false,
  reason: 'IDENTITY_NOT_VERIFIED',
})
expect(finalAcceptance.creditDeducted).toBe(false)
expect(finalAcceptance.customerDetailsUnlocked).toBe(false)
```

Use existing harness helpers rather than adding a new integration harness.

- [ ] **Step 5: Commit**

```bash
git add field-service/__tests__/integration/cross-channel-release-harness.test.ts
git commit -m "test(shortlist): cover identity blocked final acceptance"
```

Only commit if Step 4 added coverage.

---

### Task 7: Full Local Verification Pipeline

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused identity and shortlist suite**

```bash
pnpm exec vitest run \
  __tests__/lib/identity-verification/credit-gate.test.ts \
  __tests__/lib/identity-verification-credit-eligibility.test.ts \
  __tests__/provider/provider-credits-actions.test.ts \
  __tests__/lib/selected-provider-acceptance.test.ts \
  __tests__/lib/provider-acceptance-credit-unlock.test.ts \
  __tests__/lib/provider-whatsapp-interest-flow.test.ts \
  __tests__/lib/whatsapp-flows/provider-journey.test.ts \
  __tests__/lib/whatsapp-bot-stateless.test.ts \
  __tests__/lib/matching-engine.test.ts
```

Expected: all files pass.

- [ ] **Step 2: Run static checks**

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit 0.

- [ ] **Step 3: Run full unit suite**

```bash
pnpm test
```

Expected: all Vitest files pass.

- [ ] **Step 4: Run production build**

```bash
pnpm build
```

Expected: Prisma client generates, Next.js compiles, TypeScript finishes, and static page generation completes.

- [ ] **Step 5: Run cross-channel harness**

```bash
pnpm e2e
```

Expected: `__tests__/integration/cross-channel-release-harness.test.ts` passes.

- [ ] **Step 6: Run RLS verifier when DB env is available**

```bash
DATABASE_URL="$DATABASE_URL" pnpm security:rls
```

Expected: RLS verifier exits 0. If `DATABASE_URL` is missing, record this as blocked with exact output:

```text
DATABASE_URL is required to verify public-table RLS coverage.
```

---

### Task 8: Manual Phone Retest Matrix

**Files:**
- No source edits expected.
- Use Supabase/project data only after explicit approval for production data mutations.

- [ ] **Step 1: Verify locked provider top-up in PWA**

Precondition: feature flag `provider.identity.verification` is enabled and provider has `kycStatus != VERIFIED` or no current `PASSED/PASS/HIGH` identity row.

Expected:
- `/provider/credits` shows the verification CTA card.
- Package rows do not render.
- Tapping `Verify my ID` opens `/provider/verify/{token}`.
- No Pay@ or Payfast top-up intent is created before verification.

- [ ] **Step 2: Verify locked provider top-up in WhatsApp**

Send provider menu -> `Top Up Credits`.

Expected:
- Bot sends identity verification CTA.
- Bot does not send the R100/R200/R500 amount list.
- Direct `topup_payat_*` replies are still protected by the existing server-side `IDENTITY_NOT_VERIFIED` backstop.

- [ ] **Step 3: Verify selected-provider final acceptance locked path**

Precondition: provider is customer-selected but not credit-identity eligible.

Expected:
- WhatsApp `confirm_accept:<leadId>` sends identity verification CTA.
- Lead remains `CUSTOMER_SELECTED`.
- Job request remains `PROVIDER_CONFIRMATION_PENDING`.
- Provider wallet balance is unchanged.
- No `LeadUnlock` row is created.
- Customer details remain locked.

- [ ] **Step 4: Verify selected-provider final acceptance unlocked path**

Precondition: provider has `kycStatus = VERIFIED` and current identity row:

```text
status = PASSED
decision = PASS
assuranceLevel = HIGH
expiresAt = null or future
```

Expected:
- WhatsApp `confirm_accept:<leadId>` succeeds.
- Exactly one credit is debited.
- Lead reaches `ACCEPTED_LOCKED`.
- Full customer contact and exact address become available only to the selected accepted provider.
- Non-selected interested providers receive the non-selected notification and do not see full customer details.

- [ ] **Step 5: Verify flag-off regression**

Temporarily disable `provider.identity.verification` only in a safe test environment.

Expected:
- Credit top-up packages render for all providers.
- Selected-provider final acceptance follows the existing credit check/debit path without identity block.
- Server credit balance and accepted-lock behavior are unchanged.

---

### Task 9: Merge, Deploy, And Retest Readiness

**Files:**
- No source edits expected.

- [ ] **Step 1: Final status check**

```bash
git status --short
git diff --check
```

Expected: only intentional files are modified; `git diff --check` has no output.

- [ ] **Step 2: Commit remaining changes**

```bash
git add field-service docs/superpowers/plans/2026-05-26-sprint-4-6-identity-verification-qualified-shortlist.md
git commit -m "feat(shortlist): require identity for credit backed acceptance"
```

- [ ] **Step 3: Push branch**

```bash
git push -u origin codex/sprint-4-6-identity-shortlist
```

- [ ] **Step 4: Merge to main only after pipeline passes**

Use the repo's normal merge path. Do not force push. Do not deploy production manually without explicit approval.

- [ ] **Step 5: Confirm remote CI**

Expected:
- typecheck passes
- lint passes
- tests pass
- build passes

- [ ] **Step 6: Hand phone retest to user**

Report:
- branch/commit SHA
- deployment URL or production deploy status
- tested commands and counts
- blocked checks, if any
- exact phone journeys to retest

---

## Self-Review

**Spec coverage:** The plan covers flag-gated credit eligibility, PWA top-up lock, WhatsApp top-up lock, selected-provider final acceptance, one-credit debit only after identity pass, full detail unlock only after accepted lock, compatibility wrappers, tests, build, and manual phone retest.

**Placeholder scan:** No `TBD`, `TODO`, or "implement later" placeholders remain. Steps include exact files, commands, and expected outcomes.

**Type consistency:** `IDENTITY_NOT_VERIFIED`, `creditPurchaseLocked`, `assertIdentityVerifiedForCredits`, `isProviderEligibleForCredits`, `confirm_accept:<leadId>`, and `requestCreditVerificationUrl` are consistently named across tasks.
