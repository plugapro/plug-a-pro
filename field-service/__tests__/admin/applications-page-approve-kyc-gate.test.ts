// ─── F1 — approveApplication KYC gate must block when no provider is linked ──
//
// Background:
//   The KYC pre-flight added in PR #114 conditioned on
//     `if (kycRequired && app.providerId)`
//   which silently let web-resume / first-time WhatsApp applications through.
//   Those applications carry `providerId === null` at the moment of approval —
//   the gate was bypassed, crudAction ran, and syncProviderRecord then
//   silently downgraded verified=true → verified=false (its own KYC gate),
//   so the admin saw "approved" but the provider was still inactive.
//
// This test pins the new behaviour: missing providerId is treated as
// kycStatus = 'NOT_STARTED' so checkCanBeApproved blocks the approval and
// redirects to ?message=kyc_required_for_approval, matching the pre-existing
// admin banner copy.
//
// The actions in this file are inline `'use server'` functions inside
// page.tsx and are not exported, so the gate is verified two ways:
//   1. A source-string check that the conditional is no longer
//      `kycRequired && app.providerId` and that the missing-provider branch
//      defaults to NOT_STARTED.
//   2. A behavioural sanity check on checkCanBeApproved itself: with the
//      defaulted NOT_STARTED subject and kycRequired=true, the helper must
//      return { ok: false, code: 'KYC_REQUIRED' }. This is the boolean the
//      page consumes to decide whether to redirect.

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { checkCanBeApproved } from '../../lib/provider-lead-eligibility'

describe('applications page — approveApplication KYC pre-flight', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/(admin)/admin/applications/page.tsx'),
    'utf8',
  )

  it('does NOT gate the KYC pre-flight on app.providerId being present', () => {
    // The buggy condition was `if (kycRequired && app.providerId) {`. The fix
    // must enter the gate whenever kycRequired is true, regardless of whether
    // the application has been linked to a provider yet.
    expect(source).not.toMatch(/if\s*\(\s*kycRequired\s*&&\s*app\.providerId\s*\)/)
    expect(source).toMatch(/if\s*\(\s*kycRequired\s*\)\s*\{/)
  })

  it('only loads the linked provider when app.providerId is present', () => {
    // We still avoid a redundant lookup when there is nothing to fetch.
    expect(source).toMatch(/if\s*\(\s*app\.providerId\s*\)/)
  })

  it('defaults missing-provider kycStatus to NOT_STARTED inside the gate', () => {
    // When there is no linked provider, treat the subject as NOT_STARTED so
    // checkCanBeApproved blocks under the required-KYC policy.
    expect(source).toMatch(/linkedProvider\?\.kycStatus\s*\?\?\s*['"]NOT_STARTED['"]/)
  })

  it('still redirects with the kyc_required_for_approval banner code', () => {
    // The redirect target must stay aligned with the admin banner copy in
    // lib/admin-action-messages.ts so the UI keeps surfacing the right reason.
    expect(source).toContain('/admin/applications?message=kyc_required_for_approval')
  })
})

describe('checkCanBeApproved — null-provider fallback shape', () => {
  // The page constructs the subject with `linkedProvider?.kycStatus ?? 'NOT_STARTED'`
  // and `null`s for the three date-ish fields. The helper must treat that
  // subject as a blocker when kycRequired is on; otherwise the fix wouldn't
  // actually block the offending application.
  it('blocks when subject defaults to NOT_STARTED and there is no provider yet', () => {
    const result = checkCanBeApproved(
      {
        kycStatus: 'NOT_STARTED',
        createdAt: null,
        kycGraceUntil: null,
        kycOverriddenAt: null,
      },
      { kycRequired: true, kycGraceEnabled: false },
    )
    expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
  })

  it('still passes a real VERIFIED linked provider (regression guard)', () => {
    const result = checkCanBeApproved(
      {
        kycStatus: 'VERIFIED',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        kycGraceUntil: null,
        kycOverriddenAt: null,
      },
      { kycRequired: true, kycGraceEnabled: false },
    )
    expect(result).toEqual({ ok: true })
  })
})
