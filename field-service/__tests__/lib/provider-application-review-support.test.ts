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
      idNumber: null,
      notes: null,
    })

    expect(assessment.recommendation).toBe('HIGH_RISK_REVIEW')
    expect(assessment.reasonCodes).toEqual(expect.arrayContaining([
      'MISSING_SERVICE_AREAS',
      'MISSING_EXPERIENCE',
      'MISSING_ID_OR_PASSPORT',
      'HIGH_RISK_CATEGORY',
    ]))
  })

  it('routes pending applications to the ops onboarding queue and does not update approval status', async () => {
    const client = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'app-1',
            phone: '+27821234567',
            name: 'Nomsa Plumbing',
            skills: ['Plumbing'],
            serviceAreas: ['Roodepoort'],
            experience: '3 years',
            idNumber: '8001015009087',
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
})
