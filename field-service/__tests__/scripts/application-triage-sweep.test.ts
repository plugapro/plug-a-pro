import { describe, expect, it, vi, beforeEach } from 'vitest'
import { classifyApplication, type TriageInput } from '../../scripts/application-triage-sweep'

const base: TriageInput = {
  id: 'app-1',
  name: 'Sipho Test',
  phone: '+27820000001',
  skills: ['plumbing', 'painting'],
  serviceAreas: ['Honeydew', 'Florida'],
  idNumber: '9001015800081',
  status: 'PENDING',
  notes: null,
  hasVerificationRow: false,
  isActiveProviderPhone: false,
}

describe('classifyApplication', () => {
  it('rule 0: active-provider phone → DUPLICATE, no change, no send', () => {
    const d = classifyApplication({ ...base, isActiveProviderPhone: true })
    expect(d.rule).toBe('DUPLICATE')
    expect(d.targetStatus).toBeNull()
    expect(d.template).toBeNull()
  })

  it('idempotency: notes containing [triage-sweep → SKIP_ALREADY_SWEPT', () => {
    const d = classifyApplication({ ...base, notes: 'prev [triage-sweep 2026-07-01 rule-2]' })
    expect(d.rule).toBe('SKIP_ALREADY_SWEPT')
    expect(d.targetStatus).toBeNull()
  })

  it('rule 3: no pilot-suburb overlap → park + waitlist + area label', () => {
    const d = classifyApplication({ ...base, serviceAreas: ['Midrand', 'Centurion'] })
    expect(d.rule).toBe('RULE_3_OUT_OF_PILOT')
    expect(d.template).toBe('provider_area_waitlist')
    expect(d.waitlist).toBe(true)
    expect(d.areaLabel).toBe('Midrand')
    // has ID → stays PENDING
    expect(d.targetStatus).toBeNull()
  })

  it('rule 3 + no ID → MORE_INFO_REQUIRED while parked', () => {
    const d = classifyApplication({ ...base, serviceAreas: ['Midrand'], idNumber: null })
    expect(d.rule).toBe('RULE_3_OUT_OF_PILOT')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
  })

  it('rule 1: in-pilot, no idNumber, no verification row → MORE_INFO + resume nudge', () => {
    const d = classifyApplication({ ...base, idNumber: null })
    expect(d.rule).toBe('RULE_1_NO_ID')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
    expect(d.template).toBe('provider_registration_continue')
  })

  it('rule 1 exception: verification row counts as ID captured (Bernard edge)', () => {
    const d = classifyApplication({ ...base, idNumber: null, hasVerificationRow: true })
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
  })

  it('rule 2: in-pilot multi-skill with ID → APPROVED minus high-risk + cert nudge', () => {
    const d = classifyApplication(base)
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
    expect(d.targetStatus).toBe('APPROVED')
    expect(d.approvedSkills).toEqual(['painting'])
    expect(d.heldSkills).toEqual(['plumbing'])
    expect(d.template).toBe('provider_high_risk_cert_nudge')
  })

  it('rule 2 holds geyser too (any non-standard risk level)', () => {
    const d = classifyApplication({ ...base, skills: ['geyser', 'painting', 'plumbing'] })
    expect(d.heldSkills).toEqual(expect.arrayContaining(['plumbing', 'geyser']))
    expect(d.approvedSkills).toEqual(['painting'])
  })

  it('rule 2b: plumbing-only with ID → MORE_INFO + cert nudge, nothing approved', () => {
    const d = classifyApplication({ ...base, skills: ['plumbing'] })
    expect(d.rule).toBe('RULE_2B_HIGH_RISK_ONLY')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
    expect(d.approvedSkills).toBeNull()
    expect(d.template).toBe('provider_high_risk_cert_nudge')
  })

  it('normalises mixed-case skills and areas ("Plumbing", "Constantia Kloof")', () => {
    const d = classifyApplication({ ...base, skills: ['Plumbing', 'Painting'], serviceAreas: ['Constantia Kloof'] })
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
    expect(d.heldSkills).toEqual(['plumbing'])
  })
})

const { mockDb, mockSendTemplate, mockSync } = vi.hoisted(() => ({
  mockDb: {
    providerApplication: { findMany: vi.fn(), update: vi.fn() },
    provider: { findMany: vi.fn().mockResolvedValue([]) },
    providerIdentityVerification: { findMany: vi.fn().mockResolvedValue([]) },
    messageEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    serviceAreaWaitlist: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mockSendTemplate: vi.fn().mockResolvedValue({ externalId: 'wamid-1' }),
  mockSync: vi.fn().mockResolvedValue({ providerId: 'prov-1' }),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp', () => ({ sendTemplate: mockSendTemplate }))
vi.mock('@/lib/provider-record', () => ({ syncProviderRecord: mockSync }))

describe('runSweep', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const pendingApp = {
    id: 'app-1', name: 'Sipho T', phone: '+27820000001',
    skills: ['plumbing', 'painting'], serviceAreas: ['Honeydew'],
    idNumber: '9001015800081', status: 'PENDING', notes: null, providerId: null,
  }

  it('dry-run performs zero writes and zero sends', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([pendingApp])
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    const report = await runSweep({ execute: false, rules: [1, 2, 3] })

    expect(report.rows).toHaveLength(1)
    expect(mockDb.providerApplication.update).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('execute rule 2: syncProviderRecord with approved skills, AuditLog, cert nudge, notes marker', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([pendingApp])
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    await runSweep({ execute: true, rules: [2] })

    expect(mockSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      skills: ['painting'],
      verified: true,
    }))
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'app-1' },
      data: expect.objectContaining({
        status: 'APPROVED',
        notes: expect.stringContaining('[triage-sweep'),
      }),
    }))
    expect(mockDb.auditLog.create).toHaveBeenCalled()
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'provider_high_risk_cert_nudge',
      to: '+27820000001',
    }))
  })

  it('message dedup: recent same-template send → status change still applies, send skipped', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([pendingApp])
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'me-recent' })
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    const report = await runSweep({ execute: true, rules: [2] })

    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(report.rows[0].sendSkippedReason).toBe('RECENTLY_MESSAGED')
  })

  it('rule 3 without Meta approval: status+waitlist apply, send deferred', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([
      { ...pendingApp, serviceAreas: ['Midrand'] },
    ])
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    const report = await runSweep({ execute: true, rules: [3], waitlistTemplateApproved: false })

    expect(mockDb.serviceAreaWaitlist.upsert).toHaveBeenCalled()
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(report.rows[0].sendSkippedReason).toBe('TEMPLATE_NOT_APPROVED')
  })
})
