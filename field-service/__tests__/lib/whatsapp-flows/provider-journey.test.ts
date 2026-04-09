import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
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
  })

  describe('pj_menu step', () => {
    it('shows provider menu when provider exists and is online', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Sipho'),
        expect.arrayContaining([expect.objectContaining({ id: 'back_home' })])
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
        id: 'prov_1', name: 'Sipho', availableNow: false,
      })
      await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Offline'),
        expect.any(Array)
      )
    })
  })

  describe('pj_toggle_available step', () => {
    it('sets availableNow=false when provider is online and taps toggle', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: false })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_toggle'))
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: false },
      })
    })

    it('sets availableNow=true when provider is offline and taps toggle', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: false,
      })
      ;(db.provider.update as ReturnType<typeof vi.fn>).mockResolvedValue({ availableNow: true })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'pj_toggle'))
      expect(db.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov_1' },
        data: { availableNow: true },
      })
    })

    it('returns done when back_home tapped', async () => {
      const result = await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'back_home'))
      expect(result.nextStep).toBe('done')
    })
  })

  describe('pj_job_detail step', () => {
    it('shows job list when pj_view_jobs tapped from pj_toggle_available step', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true,
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
      expect(db.job.findMany).toHaveBeenCalledWith({
        where: {
          providerId: 'prov_1',
          status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'] },
        },
        include: {
          booking: {
            include: { match: { include: { jobRequest: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Your Active Jobs'),
        expect.any(Array),
        expect.any(Object)
      )
      expect(result.nextStep).toBe('pj_job_detail')
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
