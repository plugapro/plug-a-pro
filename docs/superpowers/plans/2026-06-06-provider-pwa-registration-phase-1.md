# Provider PWA Registration Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the repo foundation for provider PWA registration without exposing it to users by default.

**Architecture:** Keep `ProviderApplication` as the submitted/admin-reviewed record. Add `ProviderApplicationDraft` for partial capture, hash-only resume tokens for deep links, a disabled feature flag, proxy allowlisting for `/provider/register`, and pure helpers for routing/masking/token hashing. No identity capture rebuild; the existing `/provider/verify/[token]` flow remains authoritative.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Vitest, Supabase Auth/Storage.

---

### Task 1: Documentation Cleanup

**Files:**
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/README.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/00-claude-design-handover.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/01-current-state.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/02-proposed-design.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/03-wireframe-brief.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/04-implementation-plan.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/05-executive-summary.md`
- Modify: `docs/design/provider pwa registration/design_handoff_provider_registration/spec/06-engineering-contracts.md`

- [x] **Step 1: Replace stale repo facts**

Update application/KYC statuses to match the live schema:

```text
ApplicationStatus = PENDING | MORE_INFO_REQUIRED | APPROVED | REJECTED | CANCELLED
KycStatus = NOT_STARTED | IN_PROGRESS | SUBMITTED | VERIFIED | REJECTED | EXPIRED
```

- [x] **Step 2: Lock the draft default**

Make the default implementation choice a separate `ProviderApplicationDraft` table. Keep `ProviderApplication` as the submitted record and do not add `DRAFT` to `ApplicationStatus`.

- [x] **Step 3: Align fidelity and identity language**

Set `spec/03` to high-fidelity mobile frames, replace "optional identity verification" with deferrable required-before-credit wording, and keep `Verify later` for identity while preserving `Skip for now` only for optional work evidence.

- [x] **Step 4: Verify stale terms are removed**

Run:

```bash
rg -n 'optional identity|Step X of 7|low-to-mid|PENDING → UNDER_REVIEW|WITHDRAWN|callOutFeeCents' "docs/design/provider pwa registration/design_handoff_provider_registration"
```

Expected: no stale hits except historical/recommendation context that explicitly rejects the old wording.

### Task 2: Feature Flag And Proxy Foundation

**Files:**
- Test: `field-service/__tests__/lib/flags.test.ts`
- Test: `field-service/__tests__/proxy.test.ts`
- Modify: `field-service/lib/feature-flags-registry.ts`
- Modify: `field-service/proxy.ts`

- [ ] **Step 1: Write failing flag test**

Add to `describe('feature flag registry')`:

```ts
it('registers provider PWA registration disabled by default', () => {
  expect(FEATURE_FLAGS_REGISTRY['provider.pwa.registration']).toMatchObject({
    owner: 'prod',
    defaultValue: false,
  })
})
```

- [ ] **Step 2: Run flag test and verify red**

Run:

```bash
pnpm --dir field-service exec vitest run __tests__/lib/flags.test.ts -t "provider PWA registration"
```

Expected: FAIL because `provider.pwa.registration` is not in `FEATURE_FLAGS_REGISTRY`.

- [ ] **Step 3: Add registry entry**

Add under provider features:

```ts
'provider.pwa.registration': {
  description: 'Enable the in-PWA provider registration capture flow behind a rollout flag.',
  owner: 'prod',
  defaultValue: false,
},
```

- [ ] **Step 4: Run flag test and verify green**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Write failing proxy test**

Add a test near `/join` public route coverage:

```ts
it('keeps provider registration entry public on app domain', async () => {
  const { proxy } = await import('../proxy')

  for (const path of ['/provider/register', '/provider/register/welcome', '/provider/register/phone']) {
    const res = await proxy(new NextRequest(`https://app.plugapro.co.za${path}`))
    expect(res.status).toBe(200)
  }
})
```

- [ ] **Step 6: Run proxy test and verify red**

Run:

```bash
pnpm --dir field-service exec vitest run __tests__/proxy.test.ts -t "provider registration entry"
```

Expected: FAIL with 307 redirects to provider sign-in.

- [ ] **Step 7: Add proxy allowlist**

Add these entries to `PUBLIC_PATHS`:

```ts
'/provider/register',
'/api/provider/registration',
```

The prefix logic in `isPublicPath()` makes nested registration pages public; individual pages/actions enforce registration-session requirements.

- [ ] **Step 8: Run proxy test and verify green**

Run the same proxy test. Expected: PASS.

### Task 3: Pure Provider Registration Helpers

**Files:**
- Create: `field-service/lib/provider-registration/id-masking.ts`
- Create: `field-service/lib/provider-registration/tokens.ts`
- Create: `field-service/lib/provider-registration/resolver.ts`
- Test: `field-service/__tests__/lib/provider-registration-foundation.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create tests for:

```ts
expect(maskIdNumber('8001015009087')).toBe('*********9087')
expect(lastFour('8001015009087')).toBe('9087')
expect(await hashRegistrationResumeToken('raw-token')).not.toContain('raw-token')
expect(await verifyRegistrationResumeToken('raw-token', await hashRegistrationResumeToken('raw-token'))).toBe(true)
expect(resolveProviderRegistrationDestination({ hasActiveDraft: true, lastCompletedStep: 4, applicationStatus: 'NONE' }).route).toBe('/provider/register/availability')
```

- [ ] **Step 2: Run helper tests and verify red**

Run:

```bash
pnpm --dir field-service exec vitest run __tests__/lib/provider-registration-foundation.test.ts
```

Expected: FAIL because the helper modules do not exist.

- [ ] **Step 3: Implement helpers**

Implement `maskIdNumber`, `lastFour`, `hashRegistrationResumeToken`, `verifyRegistrationResumeToken`, and `resolveProviderRegistrationDestination` as pure functions. Use Node `crypto.createHash('sha256')` for hashing.

- [ ] **Step 4: Run helper tests and verify green**

Run the same test command. Expected: PASS.

### Task 4: Prisma Draft Schema

**Files:**
- Modify: `field-service/prisma/schema.prisma`
- Create: `field-service/prisma/migrations/<timestamp>_provider_application_drafts/migration.sql`
- Test: `field-service/__tests__/lib/provider-registration-schema-shape.test.ts`

- [ ] **Step 1: Write failing schema-shape test**

Assert the schema contains:

```ts
expect(schema).toMatch(/model ProviderApplicationDraft/)
expect(schema).toMatch(/@@map\("provider_application_drafts"\)/)
expect(schema).toMatch(/model RegistrationResumeToken/)
expect(schema).toMatch(/tokenHash\s+String\s+@unique/)
expect(schema).not.toMatch(/enum ApplicationStatus[\s\S]*DRAFT/)
```

- [ ] **Step 2: Run schema test and verify red**

Run:

```bash
pnpm --dir field-service exec vitest run __tests__/lib/provider-registration-schema-shape.test.ts
```

Expected: FAIL because the models are missing.

- [ ] **Step 3: Add Prisma models and SQL migration**

Add `ProviderApplicationDraft` and `RegistrationResumeToken` with hash-only token storage, draft progress, structured category/location arrays, existing decimal call-out fee, consent timestamp, and a nullable link to submitted `ProviderApplication`.

- [ ] **Step 4: Run schema test and verify green**

Run the same schema-shape test. Expected: PASS.

### Task 5: Focused Verification

**Files:**
- All files above.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir field-service exec vitest run \
  __tests__/lib/flags.test.ts \
  __tests__/proxy.test.ts \
  __tests__/lib/provider-registration-foundation.test.ts \
  __tests__/lib/provider-registration-schema-shape.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no trailing whitespace or whitespace errors.
