import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    technicianAvailability: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    lead: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    job: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/jobs', () => ({
  transitionJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  promptCustomersForNewProviderAvailability: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-lead-access', () => ({
  getProviderLeadAccessUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/leads/access/token'),
}))

import { handleProviderJourneyFlow } from '@/lib/whatsapp-flows/provider-journey'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'
import { transitionJob } from '@/lib/jobs'

const mockCtx = (step: string, replyId?: string, replyText?: string, data: object = {}) => ({
  phone: '+27711111111',
  step: step as any,
  data: data as any,
  flow: 'provider_journey' as const,
  reply: {
    type: replyId ? 'button_reply' as const : 'text' as const,
    id: replyId,
    text: replyText,
    title: replyId,
  },
})

describe('handleProviderJourneyFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(db.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;((db.provider as any).findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  describe('pj_menu step', () => {
    it('shows provider menu when provider exists and is online', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Sipho'),
        expect.any(Array),
        expect.any(Object),
      )
      expect(result.nextStep).toBe('pj_toggle_available')
    })

    it('prompts to register when provider not found', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const result = await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('join'))
      expect(result.nextStep).toBe('done')
    })

    it('shows offline status when availableNow is false', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: false, technicianAvailability: null,
      })
      await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Leads paused'),
        expect.any(Array),
        expect.any(Object),
      )
    })
  })

  describe('pj_toggle_available step', () => {
    it('asks for confirmation when provider is online and taps toggle', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: false })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_toggle'))
      expect(db.provider.update).not.toHaveBeenCalled()
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Pause new job leads'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'provider_pause_today' }),
          expect.objectContaining({ id: 'provider_pause_manual' }),
        ]),
      )
    })

    it('sets availableNow=false when pause is confirmed', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      await handleProviderJourneyFlow(mockCtx('pj_pause_confirm', 'provider_pause_manual'))
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: false },
      })
      expect((db as any).technicianAvailability.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'prov_1' },
          update: expect.objectContaining({ availabilityMode: 'PAUSED', availabilityState: 'PAUSED' }),
        }),
      )
    })

    it('sets availableNow=true and clears pause when provider is offline and taps toggle', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: false, technicianAvailability: null,
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: true })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_toggle'))
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: true },
      })
      expect((db as any).technicianAvailability.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'prov_1' },
          update: expect.objectContaining({ availabilityState: 'AVAILABLE', breakUntil: null }),
        })
      )
    })

    it('clears temp pause when provider taps Go Online while temp-paused', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
        technicianAvailability: {
          availabilityState: 'PAUSED',
          breakUntil: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3h in the future
        },
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: true })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_go_online'))
      // Should set online (not toggle to offline)
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: true },
      })
      // Must clear the pause state
      expect((db as any).technicianAvailability.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'prov_1' },
          update: expect.objectContaining({ availabilityState: 'AVAILABLE', breakUntil: null }),
        })
      )
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('available again'),
        expect.any(Array),
      )
    })

    it('returns done when back_home tapped', async () => {
      const result = await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'back_home'))
      expect(result.nextStep).toBe('done')
    })
  })

  describe('pj_available_leads step', () => {
    it('queries only sent/viewed leads so accepted jobs stay out of Available Jobs', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        name: 'Sipho',
        active: true,
        status: 'ACTIVE',
        availableNow: true,
      })
      ;(db.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])

      await handleProviderJourneyFlow(mockCtx('pj_available_leads', 'provider_available_jobs'))

      expect(db.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          providerId: 'prov_1',
          status: { in: ['SENT', 'VIEWED'] },
        }),
      }))
    })
  })

  describe('pj_job_detail step', () => {
    it('shows job list when pj_view_jobs tapped from pj_toggle_available step', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'jobabcdef123456789ghijklmno',
          status: 'SCHEDULED',
          providerId: 'prov_1',
          createdAt: new Date(),
          booking: {
            match: {
              jobRequest: {
                category: 'Plumbing',
                address: { street: '12 Main St', suburb: 'Sandton' },
              },
            },
          },
        },
      ])
      const result = await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_view_jobs'))
      expect(db.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          providerId: 'prov_1',
          status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'] },
        }),
        orderBy: { createdAt: 'desc' },
        take: 5,
      }))
      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Your active jobs'),
        expect.any(Array),
        expect.any(Object)
      )
      expect(result.nextStep).toBe('pj_job_detail')
    })

    it('shows an accepted lead in My Jobs before it has been converted into a formal job', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        name: 'Sipho',
        status: 'ACTIVE',
        availableNow: true,
        technicianAvailability: null,
      })
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;(db.lead.findMany as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{
          id: 'lead_1',
          providerId: 'prov_1',
          status: 'ACCEPTED',
          jobRequestId: 'jr_accepted_12345678',
          jobRequest: {
            category: 'Plumbing',
            status: 'MATCHED',
            customer: { name: 'Tiffany Mokoena' },
            address: { suburb: 'Bromhof' },
            match: {
              id: 'match_1',
              providerId: 'prov_1',
              status: 'MATCHED',
              customerContactedAt: null,
              plannedArrivalStart: null,
              providerOnTheWayAt: null,
              providerArrivedAt: null,
              providerStartedAt: null,
              providerCompletedAt: null,
              booking: null,
            },
          },
        }])

      const result = await handleProviderJourneyFlow(mockCtx('pj_job_list', 'provider_my_jobs'))

      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Your active jobs'),
        [expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({
              id: 'pj_lead_lead_1',
              title: expect.stringContaining('Plumbing'),
              description: 'Accepted',
            }),
          ]),
        })],
        expect.any(Object),
      )
      expect(result.nextStep).toBe('pj_job_detail')
    })

    it('does not show completed accepted leads as active jobs', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        name: 'Sipho',
        status: 'ACTIVE',
        availableNow: true,
        technicianAvailability: null,
      })
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;(db.lead.findMany as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{
          id: 'lead_done',
          providerId: 'prov_1',
          status: 'ACCEPTED',
          jobRequestId: 'jr_done',
          jobRequest: {
            status: 'MATCHED',
            match: {
              providerId: 'prov_1',
              status: 'MATCHED',
              providerCompletedAt: new Date(),
              booking: null,
            },
          },
        }])
        .mockResolvedValueOnce([])

      await handleProviderJourneyFlow(mockCtx('pj_job_list', 'provider_my_jobs'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('No active jobs right now'),
        expect.any(Array),
      )
    })

    it('opens a secure View Job CTA for an accepted lead selected from My Jobs', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        name: 'Sipho',
        availableNow: true,
      })
      ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'lead_1',
        providerId: 'prov_1',
        status: 'ACCEPTED',
        jobRequestId: 'jr_accepted_12345678',
        jobRequest: {
          category: 'Plumbing',
          status: 'MATCHED',
          customer: { name: 'Tiffany Mokoena' },
          address: { suburb: 'Bromhof' },
          match: {
            id: 'match_1',
            providerId: 'prov_1',
            status: 'MATCHED',
            customerContactedAt: null,
            plannedArrivalStart: null,
            providerOnTheWayAt: null,
            providerArrivedAt: null,
            providerStartedAt: null,
            providerCompletedAt: null,
          },
        },
      })

      const result = await handleProviderJourneyFlow(mockCtx('pj_job_detail', 'pj_lead_lead_1'))

      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Next step: *Confirm arrival time*'),
        'View Job',
        'https://app.plugapro.co.za/leads/access/token',
        expect.any(Object),
      )
      expect(result.nextStep).toBe('done')
    })

    it('returns done when back_home tapped', async () => {
      const result = await handleProviderJourneyFlow(mockCtx('pj_job_detail', 'back_home'))
      expect(result.nextStep).toBe('done')
    })

    it('shows status update buttons for a SCHEDULED job', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'jobabcdef123456789ghijklmno',
        status: 'SCHEDULED',
        providerId: 'prov_1',
        booking: {
          match: {
            jobRequest: {
              category: 'Plumbing',
              address: { street: '12 Main St', suburb: 'Sandton' },
            },
          },
        },
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_job_detail', 'pj_job_jobabcdef123456789ghijklmno'))
      expect(db.job.findUnique).toHaveBeenCalledWith({
        where: { id: 'jobabcdef123456789ghijklmno' },
        include: {
          booking: {
            include: {
              match: {
                include: {
                  jobRequest: { include: { address: true } },
                },
              },
            },
          },
        },
      })
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Plumbing'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'pj_upd_jobabcdef123456789ghijklmno_EN_ROUTE', title: expect.any(String) }),
        ])
      )
      expect(result.nextStep).toBe('pj_status_confirm')
      expect(result.nextData).toEqual({ activeJobId: 'jobabcdef123456789ghijklmno' })
    })

    it('shows "no more updates" message for job with no transitions', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'jobabcdef123456789ghijklmno',
        status: 'AWAITING_APPROVAL',
        providerId: 'prov_1',
        booking: {
          match: {
            jobRequest: {
              category: 'Plumbing',
              address: { street: '12 Main St', suburb: 'Sandton' },
            },
          },
        },
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_job_detail', 'pj_job_jobabcdef123456789ghijklmno'))
      expect(wa.sendText).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('No more status updates')
      )
      expect(result.nextStep).toBe('done')
    })
  })

  describe('pj_status_confirm step', () => {
    it('uses the central state machine for provider WhatsApp status updates', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
      })
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'jobabcdef123456789ghijklmno',
        status: 'STARTED',
        providerId: 'prov_1',
        booking: {
          match: {
            jobRequest: {
              category: 'Plumbing',
              customer: { phone: '+27711111112' },
            },
          },
        },
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_status_confirm', 'pj_upd_jobabcdef123456789ghijklmno_PENDING_COMPLETION_CONFIRMATION'))
      expect(transitionJob).toHaveBeenCalledWith({
        jobId: 'jobabcdef123456789ghijklmno',
        toStatus: 'PENDING_COMPLETION_CONFIRMATION',
        actorId: 'prov_1',
        actorRole: 'provider',
        notes: 'Updated via WhatsApp by provider',
      })
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('sign-off'),
        expect.any(Array)
      )
      expect(result.nextStep).toBe('pj_toggle_available')
    })

    it('returns done when back_home tapped', async () => {
      const result = await handleProviderJourneyFlow(mockCtx('pj_status_confirm', 'back_home'))
      expect(result.nextStep).toBe('done')
    })

    it('stays on same step when unrecognised button', async () => {
      const result = await handleProviderJourneyFlow(mockCtx('pj_status_confirm', 'invalid_button'))
      expect(result.nextStep).toBe('pj_status_confirm')
    })
  })
})
