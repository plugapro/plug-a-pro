import { describe, expect, it, vi } from 'vitest'
import {
  assessProviderApplicationForOpsReview,
  routeProviderApplicationsForOpsReview,
} from '../../lib/provider-application-review-support'

describe('provider application review support', () => {
  it('flags incomplete and high-risk applications without approving them', () => {
    const assessment = assessProviderApplicationForOpsReview({
      id: 'app-1',
      phone: '+27821234567',
      name: 'Thabo',
      skills: ['Electrical'],
      serviceAreas: [],
      experience: null,
      notes: null,
    })

    expect(assessment.recommendation).toBe('HIGH_RISK_REVIEW')
    expect(assessment.reasonCodes).toEqual(expect.arrayContaining([
      'MISSING_SERVICE_AREAS',
      'MISSING_EXPERIENCE',
      'HIGH_RISK_CATEGORY',
    ]))
    expect(assessment.reasonCodes).not.toContain('MISSING_ID_OR_PASSPORT')
  })

  it('flags a complete high-risk application for manual review', () => {
    const assessment = assessProviderApplicationForOpsReview({
      id: 'app-2',
      phone: '+27821234568',
      name: 'Lovemore Sibanda',
      skills: ['Electrical', 'Handyman'],
      serviceAreas: ['Bromhof'],
      experience: '5 years',
      notes: null,
    })

    expect(assessment.recommendation).toBe('HIGH_RISK_REVIEW')
    expect(assessment.reasonCodes).toEqual(['HIGH_RISK_CATEGORY'])
  })

  it('routes pending applications to the ops onboarding queue and does not update approval status', async () => {
    const client = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'app-1',
            phone: '+27821234567',
            name: 'Nomsa Painting',
            skills: ['Painting'],
            serviceAreas: ['Roodepoort'],
            experience: '3 years',
            notes: null,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      opsQueueAssignment: {
        upsert: vi.fn().mockResolvedValue({ id: 'queue-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }

    await expect(routeProviderApplicationsForOpsReview(client)).resolves.toEqual({ routed: 1, flagged: 0 })
    expect(client.opsQueueAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        queueType: 'PROVIDER_ONBOARDING',
        entityId: 'app-1',
      }),
    }))
    expect(client.providerApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'app-1', status: 'PENDING' },
      data: expect.objectContaining({
        notes: expect.stringContaining('READY_FOR_OPS_REVIEW'),
      }),
    }))
    expect(client.providerApplication.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED' }),
    }))
  })

  it('replaces existing ops-review support notes instead of appending duplicate entries', async () => {
    const client = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'app-risk',
            phone: '+27820000090',
            name: 'Lovemore Sibanda',
            skills: ['Electrical'],
            serviceAreas: ['Bromhof'],
            experience: '8 years',
            notes: '[ops-review-support] READY_FOR_OPS_REVIEW: MISSING_SERVICE_AREAS',
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      opsQueueAssignment: {
        upsert: vi.fn().mockResolvedValue({ id: 'queue-2' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-2' }),
      },
    }

    await routeProviderApplicationsForOpsReview(client)

    expect(client.providerApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'app-risk', status: 'PENDING' },
      data: {
        notes: '[ops-review-support] HIGH_RISK_REVIEW: HIGH_RISK_CATEGORY',
      },
    }))
  })
})
