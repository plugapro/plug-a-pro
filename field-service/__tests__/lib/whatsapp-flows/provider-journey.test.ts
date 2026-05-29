import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => {
  const providerMock = { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() }
  const availabilityMock = { upsert: vi.fn().mockResolvedValue({}) }
  const txClient = { provider: providerMock, technicianAvailability: availabilityMock }
  return {
    db: {
      provider: providerMock,
      providerApplication: { findFirst: vi.fn() },
      technicianAvailability: availabilityMock,
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      lead: { findMany: vi.fn(), findUnique: vi.fn() },
      job: { findMany: vi.fn(), findUnique: vi.fn() },
      providerIdentityVerification: { findFirst: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    },
  }
})

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue({}),
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
  getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/provider/jobs/job-request-1/handover?token=token'),
}))

vi.mock('@/lib/provider-credit-payment-intents', () => ({
  createPayatTopUpIntent: vi.fn(),
}))

vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: vi.fn().mockResolvedValue({
    verificationId: 'ver-1',
    verificationUrl: 'https://app.plugapro.co.za/provider/verify/secure-token',
    expiresAt: new Date('2026-05-28T10:00:00.000Z'),
    reused: false,
    status: 'NOT_STARTED',
  }),
}))

vi.mock('@/lib/identity-verification/credit-gate', () => ({
  buildHighAssuranceCreditVerificationWhere: vi.fn((providerId: string) => ({
    providerId,
    status: 'PASSED',
    decision: 'PASS',
    assuranceLevel: 'HIGH',
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date('2026-05-25T00:00:00.000Z') } }],
  })),
  isProviderEligibleForCredits: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentIntentCreated: vi.fn().mockResolvedValue(undefined),
  notifyProviderPaymentCredited: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-wallet', () => ({
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5_000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5_000,
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue({
    providerId: 'prov_1',
    paidCreditBalance: 2,
    promoCreditBalance: 3,
    totalCreditBalance: 5,
    status: 'ACTIVE',
  }),
}))

import { handleProviderJourneyFlow } from '@/lib/whatsapp-flows/provider-journey'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'
import { transitionJob } from '@/lib/jobs'
import { recordAuditLog } from '@/lib/audit'
import * as paymentIntents from '@/lib/provider-credit-payment-intents'
import * as walletNotifications from '@/lib/provider-wallet-notifications'
import { issueProviderIdentityVerificationLink } from '@/lib/identity-verification/link'
import { isProviderEligibleForCredits } from '@/lib/identity-verification/credit-gate'

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
    ;((db as any).providerIdentityVerification.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;((db as any).providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  })

  describe('pj_menu step', () => {
    it('shows provider menu when provider exists and is online', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      const result = await handleProviderJourneyFlow(mockCtx('pj_menu'))
      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Credits balance: *5 credits*'),
        [expect.objectContaining({
          rows: [
            expect.objectContaining({ id: 'provider_check_status', title: 'View Credits' }),
            expect.objectContaining({ id: 'provider_available_jobs', title: 'View Opportunities' }),
            expect.objectContaining({ id: 'provider_my_jobs', title: 'View Active Jobs' }),
            expect.objectContaining({ title: 'Update Availability' }),
            expect.objectContaining({ id: 'provider_profile', title: 'Update Profile' }),
            expect.objectContaining({ id: 'provider_support', title: 'Contact Support' }),
          ],
        })],
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
        expect.stringContaining('Starter/onboarding: 3 · Purchased: 2'),
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
        expect.stringContaining('How long do you need a break'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'pause_30m' }),
          expect.objectContaining({ id: 'pause_1h' }),
          expect.objectContaining({ id: 'pause_2h' }),
          expect.objectContaining({ id: 'pause_today' }),
          expect.objectContaining({ id: 'pause_indefinite' }),
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
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Credits balance: *5 credits*'),
        expect.any(Array),
      )
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
        'View job',
        'https://app.plugapro.co.za/provider/jobs/job-request-1/handover?token=token',
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

  describe('My Jobs exclusion and normalization filters', () => {
    it('excludes a cancelled job request from My Jobs', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', status: 'ACTIVE', availableNow: true, technicianAvailability: null,
      })
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      // lead whose jobRequest is CANCELLED - should be excluded by the DB query
      ;(db.lead.findMany as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // accepted leads query returns empty (DB excluded it)
        .mockResolvedValueOnce([]) // pending available leads

      await handleProviderJourneyFlow(mockCtx('pj_job_list', 'provider_my_jobs'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('No active jobs right now'),
        expect.any(Array),
      )
    })

    it('excludes an expired job request from My Jobs', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', status: 'ACTIVE', availableNow: true, technicianAvailability: null,
      })
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;(db.lead.findMany as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // DB excluded expired lead
        .mockResolvedValueOnce([])

      await handleProviderJourneyFlow(mockCtx('pj_job_list', 'provider_my_jobs'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('No active jobs right now'),
        expect.any(Array),
      )
    })

    it('excludes an accepted lead reassigned to a different provider', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', status: 'ACTIVE', availableNow: true, technicianAvailability: null,
      })
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      // DB query filters providerId=prov_1 so a reassigned lead (match.providerId=other) never returns
      ;(db.lead.findMany as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await handleProviderJourneyFlow(mockCtx('pj_job_list', 'provider_my_jobs'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('No active jobs right now'),
        expect.any(Array),
      )
    })

    it('resolves a local SA phone number (0711111111) to the same provider via findMany fallback', async () => {
      // Exact findUnique lookup returns null (phone stored as +27711111111, incoming is local 0711111111)
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(db.provider.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
        id: 'prov_1', name: 'Sipho', status: 'ACTIVE', availableNow: true, technicianAvailability: null,
      }])
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;(db.lead.findMany as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const localCtx = { ...mockCtx('pj_job_list', 'provider_my_jobs'), phone: '0711111111' }
      await handleProviderJourneyFlow(localCtx as any)

      // Must have fallen back to findMany with phone variants
      expect(db.provider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            phone: expect.objectContaining({ in: expect.arrayContaining(['+27711111111', '0711111111']) }),
          }),
        }),
      )
      // Provider was found; no "not registered" error sent
      expect(wa.sendText).not.toHaveBeenCalledWith('0711111111', expect.stringContaining('not registered'))
    })

    it('logs a warning when duplicate provider records share the same phone number', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(db.provider.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'prov_1', name: 'Sipho', status: 'ACTIVE', availableNow: true, technicianAvailability: null },
        { id: 'prov_2', name: 'Sipho Dup', status: 'ACTIVE', availableNow: true, technicianAvailability: null },
      ])
      ;(db.job.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;(db.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

      await handleProviderJourneyFlow(mockCtx('pj_job_list', 'provider_my_jobs'))

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('duplicate provider phone records detected'),
        expect.objectContaining({ providerIds: expect.arrayContaining(['prov_1', 'prov_2']) }),
      )
      warnSpy.mockRestore()
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

  describe('pj_pause_confirm - provider_pause_today', () => {
    it('sets breakUntil to 23:59:59 of today when provider_pause_today selected', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      await handleProviderJourneyFlow(mockCtx('pj_pause_confirm', 'provider_pause_today'))
      const upsertArgs = ((db as any).technicianAvailability.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const breakUntil = upsertArgs.create.breakUntil as Date
      expect(breakUntil).toBeInstanceOf(Date)
      expect(breakUntil.getHours()).toBe(23)
      expect(breakUntil.getMinutes()).toBe(59)
      expect(breakUntil.getSeconds()).toBe(59)
    })
  })

  describe('pj_provider_status step', () => {
    const baseProvider = {
      id: 'prov_1',
      name: 'Sipho',
      availableNow: true,
      active: true,
      status: 'ACTIVE',
      skills: ['Plumbing'],
      serviceAreas: [],
      suspendedReason: null,
      suspendedUntil: null,
      technicianAvailability: {
        availabilityMode: 'ALWAYS_AVAILABLE',
        availabilityState: 'AVAILABLE',
        emergencyAvailable: true,
        breakUntil: null,
      },
      schedule: [],
      technicianServiceAreas: [{ label: 'Randburg' }],
    }

    it('shows availability mode, service areas and emergency flag in message body', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(baseProvider)
      await handleProviderJourneyFlow(mockCtx('pj_provider_status'))
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Always available'),
        expect.any(Array),
      )
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Randburg'),
        expect.any(Array),
      )
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('On'),
        expect.any(Array),
      )
    })

    it('shows WhatsApp credit summary and credits history CTA without raw URL in body', async () => {
      vi.stubEnv('APP_PUBLIC_URL', 'https://app.plugapro.co.za')
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(baseProvider)
      await handleProviderJourneyFlow(mockCtx('pj_provider_status', 'provider_check_status'))

      const message = (wa.sendButtons as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(message).toContain('Your credits')
      expect(message).toContain('Available: 5')
      expect(message).toContain('Starter/onboarding: 3')
      expect(message).toContain('Purchased: 2')
      expect(message).toContain('Credits are used only when you accept a customer-selected job')
      expect(message).not.toContain('https://')
      expect(message).not.toContain('/provider/credits')
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Credits history is available below'),
        'View credits history',
        'https://app.plugapro.co.za/provider/credits',
        undefined,
        expect.any(Object),
      )
      vi.unstubAllEnvs()
    })

    it('shows Go Available button and paused message when provider is paused', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...baseProvider,
        availableNow: false,
        technicianAvailability: {
          availabilityMode: 'PAUSED',
          availabilityState: 'PAUSED',
          emergencyAvailable: false,
          breakUntil: null,
        },
      })
      await handleProviderJourneyFlow(mockCtx('pj_provider_status'))
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('paused'),
        expect.arrayContaining([expect.objectContaining({ id: 'provider_go_available' })]),
      )
    })

    it('explains pending review for inactive provider instead of using active-provider credits path', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...baseProvider,
        id: 'prov_pending',
        name: 'Lovemore Moyo',
        active: false,
        availableNow: false,
        status: 'APPLICATION_PENDING',
        technicianAvailability: null,
      })
      ;((db as any).providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_lovemore_12345678',
        name: 'Lovemore Moyo',
        status: 'PENDING',
        providerId: 'prov_pending',
        notes: null,
      })

      await handleProviderJourneyFlow(mockCtx('pj_provider_status', 'provider_status'))

      const message = (wa.sendButtons as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(message).toContain('provider application is waiting for review')
      expect(message).toContain('Ref: *12345678*')
      expect(message).toContain('profile will stay inactive until approval is complete')
      expect(message).not.toContain("couldn't complete that step")
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ id: 'provider_status_retry', title: 'Check again' }),
          expect.objectContaining({ id: 'back_home', title: 'Main Menu' }),
        ]),
      )
    })

    it('does not crash provider status when active provider credits wallet is missing', async () => {
      const wallet = await import('@/lib/provider-wallet')
      vi.mocked(wallet.getProviderWalletBalanceReadOnly).mockRejectedValueOnce(new Error('wallet missing'))
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(baseProvider)

      await handleProviderJourneyFlow(mockCtx('pj_provider_status', 'provider_status_retry'))

      const message = (wa.sendButtons as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(message).toContain('Credits balance: not available yet')
      expect(message).toContain('Provider profile: *ACTIVE*')
    })

    it('shows no-application recovery when provider and application are missing', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;((db.provider as any).findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
      ;((db as any).providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      await handleProviderJourneyFlow(mockCtx('pj_provider_status', 'provider_status'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining("couldn't find a provider application"),
        expect.arrayContaining([
          expect.objectContaining({ id: 'reg_start', title: 'Apply as provider' }),
        ]),
      )
    })
  })

  describe('pj_topup_select_amount step', () => {
    const activeProvider = {
      id: 'prov_1',
      name: 'Sipho',
      phone: '+27711111111',
      availableNow: true,
      technicianAvailability: null,
      active: true,
      status: 'ACTIVE',
    }

    beforeEach(() => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(activeProvider)
      ;(isProviderEligibleForCredits as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    })

    it('shows package list when entering the step from menu', async () => {
      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup'),
      )
      expect(wa.sendList).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Top Up Credits'),
        [expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'provider_topup_100' }),
            expect.objectContaining({ id: 'provider_topup_200' }),
            expect.objectContaining({ id: 'provider_topup_500' }),
          ]),
        })],
        expect.anything(),
      )
      expect(result.nextStep).toBe('pj_topup_select_amount')
    })

    it('shows package list again on unrecognised reply', async () => {
      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'back_home'),
      )
      expect(wa.sendList).toHaveBeenCalled()
      expect(result.nextStep).toBe('pj_topup_select_amount')
    })

    it('sends verification CTA instead of package list when provider is not high-assurance verified', async () => {
      ;(isProviderEligibleForCredits as ReturnType<typeof vi.fn>).mockResolvedValue(false)

      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup'),
      )

      expect(isProviderEligibleForCredits).toHaveBeenCalledWith('prov_1')
      expect(issueProviderIdentityVerificationLink).toHaveBeenCalledWith({
        providerId: 'prov_1',
        channel: 'PWA',
        purpose: 'CREDIT_TOP_UP',
      })
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Identity check required'),
        expect.any(String),
        'https://app.plugapro.co.za/provider/verify/secure-token',
      )
      expect(wa.sendList).not.toHaveBeenCalled()
      expect(result.nextStep).toBe('done')
    })

    it('sends verification CTA instead of creating Pay@ intent when stale amount button is tapped by unverified provider', async () => {
      ;(isProviderEligibleForCredits as ReturnType<typeof vi.fn>).mockResolvedValue(false)

      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup_100'),
      )

      expect(paymentIntents.createPayatTopUpIntent).not.toHaveBeenCalled()
      expect(issueProviderIdentityVerificationLink).toHaveBeenCalledWith({
        providerId: 'prov_1',
        channel: 'PWA',
        purpose: 'CREDIT_TOP_UP',
      })
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Identity check required'),
        expect.any(String),
        'https://app.plugapro.co.za/provider/verify/secure-token',
      )
      expect(result.nextStep).toBe('done')
    })

    it('creates Pay@ intent and sends CTA with fee breakdown when R100 is selected', async () => {
      ;(paymentIntents.createPayatTopUpIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
        intent: { id: 'intent-1', paymentMethod: 'PAYAT' },
        payat: { paymentLink: 'https://pay.at/link/abc123' },
        payAtAmountCents: 10_700,
      })

      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup_100'),
      )

      expect(paymentIntents.createPayatTopUpIntent).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'prov_1', amountCents: 10_000, feeAmountCents: 700 }),
      )
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('R107'),
        expect.any(String),
        'https://pay.at/link/abc123',
      )
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('R100'),
        expect.any(String),
        expect.any(String),
      )
      expect(result.nextStep).toBe('pj_topup_payat_created')
    })

    it('sends error text and stays on amount step when Pay@ intent creation fails', async () => {
      ;(paymentIntents.createPayatTopUpIntent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Provider not found'),
      )

      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup_100'),
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Could not create your top-up'),
      )
      expect(result.nextStep).toBe('pj_topup_select_amount')
    })

    it('guides provider to verification when Pay@ intent requires identity verification', async () => {
      ;(paymentIntents.createPayatTopUpIntent as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'IDENTITY_NOT_VERIFIED',
      })

      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup_100'),
      )

      expect(issueProviderIdentityVerificationLink).toHaveBeenCalledWith({
        providerId: 'prov_1',
        channel: 'PWA',
        purpose: 'CREDIT_TOP_UP',
      })
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Identity check required'),
        expect.any(String),
        'https://app.plugapro.co.za/provider/verify/secure-token',
      )
      expect(result.nextStep).toBe('pj_topup_select_amount')
    })

    it('shows not-registered message when provider is not found', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const result = await handleProviderJourneyFlow(
        mockCtx('pj_topup_select_amount', 'provider_topup'),
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('not registered'),
      )
      expect(result.nextStep).toBe('done')
    })
  })

  describe('pj_verify_identity step', () => {
    it('issues a tokenized verification CTA for an unverified provider', async () => {
      ;((db.provider as any).findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        kycStatus: 'NOT_STARTED',
      })

      const result = await handleProviderJourneyFlow(mockCtx('pj_verify_identity'))

      expect(issueProviderIdentityVerificationLink).toHaveBeenCalledWith({
        providerId: 'prov_1',
        channel: 'PWA',
      })
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Identity Verification'),
        expect.any(String),
        'https://app.plugapro.co.za/provider/verify/secure-token',
      )
      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('WhatsApp fallback'),
        [
          { id: 'iv_start_whatsapp', title: 'Use WhatsApp' },
          { id: 'back_home', title: 'Main Menu' },
        ],
      )
      expect(result.nextStep).toBe('done')
    })

    it('returns a specific retry path when the identity verification CTA cannot be sent', async () => {
      ;((db.provider as any).findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        kycStatus: 'NOT_STARTED',
      })
      vi.mocked(wa.sendCtaUrl).mockRejectedValueOnce(
        new Error('[sendCtaUrl] CTA URL button text must be 20 characters or fewer.'),
      )

      const result = await handleProviderJourneyFlow(mockCtx('pj_verify_identity'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('secure identity link'),
        [
          { id: 'provider_verify_identity', title: 'Try again' },
          { id: 'back_home', title: 'Main Menu' },
        ],
      )
      expect(result.nextStep).toBe('done')
    })

    it('offers PWA step-up when provider is only LOW-assurance verified from WhatsApp', async () => {
      ;((db.provider as any).findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        kycStatus: 'VERIFIED',
      })
      ;((db as any).providerIdentityVerification.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
        async (args: { where?: { assuranceLevel?: string } }) => {
          if (args.where?.assuranceLevel === 'HIGH') return null

          return {
            id: 'ver-low-1',
            status: 'PASSED',
            decision: 'PASS',
            assuranceLevel: 'LOW',
            expiresAt: null,
          }
        },
      )

      const result = await handleProviderJourneyFlow(mockCtx('pj_verify_identity'))

      expect(issueProviderIdentityVerificationLink).toHaveBeenCalledWith({
        providerId: 'prov_1',
        channel: 'PWA',
      })
      expect(wa.sendCtaUrl).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('liveness step'),
        expect.any(String),
        'https://app.plugapro.co.za/provider/verify/secure-token',
      )
      expect(result.nextStep).toBe('done')
    })

    it('treats any current HIGH-assurance verification as complete even when a newer LOW-assurance row exists', async () => {
      ;((db.provider as any).findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1',
        kycStatus: 'VERIFIED',
      })
      ;((db as any).providerIdentityVerification.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
        async (args: { where?: { assuranceLevel?: string } }) => {
          if (args.where?.assuranceLevel === 'HIGH') {
            return { id: 'ver-high-1', providerId: 'prov_1' }
          }

          return {
            id: 'ver-low-1',
            status: 'PASSED',
            decision: 'PASS',
            assuranceLevel: 'LOW',
            expiresAt: null,
          }
        },
      )

      const result = await handleProviderJourneyFlow(mockCtx('pj_verify_identity'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        '+27711111111',
        expect.stringContaining('Identity already verified'),
        [{ id: 'back_home', title: 'Main Menu' }],
      )
      expect(issueProviderIdentityVerificationLink).not.toHaveBeenCalled()
      expect(result.nextStep).toBe('done')
    })
  })

  describe('provider menu has 6 items matching blueprint order', () => {
    it('pj_menu has exactly 6 rows: View Credits, View Opportunities, View Active Jobs, Update Availability, Update Profile, Contact Support', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
        active: true, status: 'ACTIVE',
      })
      await handleProviderJourneyFlow(mockCtx('pj_menu'))
      const listCall = (wa.sendList as ReturnType<typeof vi.fn>).mock.calls[0]
      const rows = listCall[2][0].rows as Array<{ id: string; title: string }>
      expect(rows).toHaveLength(6)
      expect(rows.map((r) => r.id)).toContain('provider_check_status')
      expect(rows.map((r) => r.id)).toContain('provider_available_jobs')
      expect(rows.map((r) => r.id)).toContain('provider_my_jobs')
      expect(rows.map((r) => r.id)).toContain('provider_profile')
      expect(rows.map((r) => r.id)).toContain('provider_support')
      // Top Up Credits is now accessible from the credits screen, not the main menu
      expect(rows.map((r) => r.id)).not.toContain('provider_topup')
    })
  })

  describe('audit log assertions', () => {
    it('records audit log when provider pauses leads', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: true, technicianAvailability: null,
      })
      await handleProviderJourneyFlow(mockCtx('pj_pause_confirm', 'provider_pause_manual'))
      expect(recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'prov_1',
          action: 'provider.availability.paused',
        }),
      )
    })

    it('records audit log when provider goes available', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'prov_1', name: 'Sipho', availableNow: false, technicianAvailability: null,
      })
      await handleProviderJourneyFlow(mockCtx('pj_toggle_available', 'provider_go_available'))
      expect(recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'prov_1',
          action: 'provider.availability.available',
        }),
      )
    })
  })
})
