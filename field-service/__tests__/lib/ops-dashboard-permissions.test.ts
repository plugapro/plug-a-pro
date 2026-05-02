import { describe, expect, it } from 'vitest'
import { roleCan, rolesForCapability } from '../../lib/ops-dashboard/permissions'

describe('ops dashboard permissions', () => {
  it('allows ops agents to review queues but not approve providers or adjust credits', () => {
    expect(roleCan('OPS', 'viewRequests')).toBe(true)
    expect(roleCan('OPS', 'reviewProviderApplications')).toBe(true)
    expect(roleCan('OPS', 'approveProviders')).toBe(false)
    expect(roleCan('OPS', 'adjustCredits')).toBe(false)
  })

  it('requires finance-or-above for credit ledger and adjustments', () => {
    expect(roleCan('FINANCE', 'viewCreditLedger')).toBe(true)
    expect(roleCan('FINANCE', 'adjustCredits')).toBe(true)
    expect(roleCan('OPS', 'viewCreditLedger')).toBe(false)
  })

  it('reserves scheduler runs and audit log access for admin-or-owner', () => {
    expect(rolesForCapability('runSchedulers')).toEqual(['ADMIN', 'OWNER'])
    expect(roleCan('ADMIN', 'runSchedulers')).toBe(true)
    expect(roleCan('TRUST', 'runSchedulers')).toBe(false)
    expect(roleCan('OWNER', 'viewAuditLog')).toBe(true)
  })
})
