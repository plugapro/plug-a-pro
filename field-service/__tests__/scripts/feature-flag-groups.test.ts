import { describe, expect, it } from 'vitest'
import type { FeatureFlagKey } from '@/lib/feature-flags-registry'
import {
  OPS_CRUD_FEATURE_FLAGS,
  listRegisteredFeatureFlagKeys,
  resolveFeatureFlagTargets,
} from '../../scripts/feature-flag-groups'

const IMPLEMENTED_OPS_CRUD_FLAGS = [
  'admin.crud.locations',
  'admin.crud.customers',
  'admin.crud.providers',
  'admin.crud.bookings',
  'admin.crud.payments',
  'admin.crud.disputes',
  'admin.crud.applications',
  'admin.crud.quotes',
  'admin.crud.dispatch',
  'admin.crud.validation',
  'admin.crud.field_exceptions',
  'admin.crud.categories',
  'admin.categories.risk_tier',
  'admin.crud.messages',
  'admin.crud.verifications',
  'admin.users.v2',
  'admin.applications.redesign_v2',
  'admin.quotes.send',
  'admin.invoices.actions',
  'admin.messages.outbound',
  'admin.customers.whatsapp_pref_toggle',
  'admin.vouchers',
  'ops.v2.cases',
  'ops.v2.closeOut',
] as const satisfies readonly FeatureFlagKey[]

const NON_CRUD_OR_UNIMPLEMENTED_FLAGS = [
  'admin.payments.retry',
  'auth.otp.whatsapp',
  'customer.messaging.v1',
  'customer.realtime.v1',
  'feature.customer.address_book',
  'feature.customer.auto_assign_on_submit',
  'feature.customer.operator_member',
  'feature.customer.provider_browse',
  'feature.deadlineed.b2b_landing',
  'feature.provider.pwa_inbox',
  'matching.v2.candidate_pool',
  'ops.v2.audit',
  'ops.v2.breachBanner',
  'ops.v2.bulkActions',
  'ops.v2.dispatchOverride',
  'ops.v2.duplicates',
  'ops.v2.notes',
  'ops.v2.profileV2',
  'pilot.completion-check',
  'provider.identity.verification',
  'provider.identity.vendor.datanamix',
  'provider.identity.vendor.omnicheck',
  'provider.identity.vendor.smile_id',
  'provider.identity.vendor.thisisme',
  'provider.onboarding.auto_approve',
  'qualified_shortlist.auto_trigger',
  'qualified_shortlist.dispatch_v2',
] as const satisfies readonly FeatureFlagKey[]

describe('feature flag rollout groups', () => {
  it('contains every implemented ops/admin CRUD flag', () => {
    expect([...OPS_CRUD_FEATURE_FLAGS].sort()).toEqual([...IMPLEMENTED_OPS_CRUD_FLAGS].sort())
  })

  it('excludes reserved, vendor, auth, customer, provider, matching and pilot flags', () => {
    for (const flag of NON_CRUD_OR_UNIMPLEMENTED_FLAGS) {
      expect(OPS_CRUD_FEATURE_FLAGS).not.toContain(flag)
    }
  })

  it('resolves ops-crud targets with registry descriptions', () => {
    const targets = resolveFeatureFlagTargets({ group: 'ops-crud' })

    expect(targets).toHaveLength(IMPLEMENTED_OPS_CRUD_FLAGS.length)
    expect(targets.map((target) => target.key).sort()).toEqual([...IMPLEMENTED_OPS_CRUD_FLAGS].sort())
    expect(targets.every((target) => target.description.length > 0)).toBe(true)
  })

  it('resolves a single registered flag', () => {
    expect(resolveFeatureFlagTargets({ flag: 'admin.crud.locations' })).toEqual([
      {
        key: 'admin.crud.locations',
        description: 'Enable create/update/delete mutations on the Location Taxonomy admin page.',
      },
    ])
  })

  it('rejects unknown or ambiguous rollout targets', () => {
    expect(() => resolveFeatureFlagTargets({ flag: 'admin.crud.missing' })).toThrow('Unknown flag')
    expect(() => resolveFeatureFlagTargets({ group: 'missing' })).toThrow('Unknown flag group')
    expect(() => resolveFeatureFlagTargets({ flag: 'admin.crud.locations', group: 'ops-crud' })).toThrow(
      'Use either --flag or --group',
    )
  })

  it('includes the WhatsApp recovery template-send flag in registry-backed seed targets', () => {
    expect(listRegisteredFeatureFlagKeys()).toContain('whatsapp.recovery.template_send')
  })
})
