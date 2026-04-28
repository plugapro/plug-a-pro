import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    providerApplication: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    job: {
      count: vi.fn(),
    },
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    jobRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    attachment: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn(),
}))

vi.mock('@/lib/location-nodes', () => ({
  getProvinces: vi.fn(),
  getCities: vi.fn(),
  getRegions: vi.fn(),
  getSuburbs: vi.fn(),
  getStructuredAddressSelection: vi.fn(),
}))

vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn(),
  isActiveCity: vi.fn(),
  isActiveRegion: vi.fn(),
  addToServiceAreaWaitlist: vi.fn(),
}))

vi.mock('@/lib/category-config', () => ({
  resolveCategoryRequirements: vi.fn(),
}))

vi.mock('@/lib/job-requests/create-job-request', () => ({
  createJobRequest: vi.fn(),
}))

vi.mock('@/lib/structured-address', () => ({
  resolveStructuredAddressCapture: vi.fn(),
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {},
}))

vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: vi.fn(),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  checkJobsForNewProviderAvailability: vi.fn(),
}))

import { showMainMenu } from '@/lib/whatsapp-flows/job-request'
import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'

const PHONE = '+27823035070'

function listRows() {
  return vi.mocked(wa.sendList).mock.calls[0]?.[2]?.flatMap((section: any) => section.rows) ?? []
}

describe('role-aware WhatsApp main menu routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.provider.findFirst).mockResolvedValue(null)
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue(null)
    vi.mocked(db.job.count).mockResolvedValue(0)
    vi.mocked(db.customer.findFirst).mockResolvedValue(null)
  })

  it('keeps Find Work for unknown users', async () => {
    await showMainMenu(PHONE)

    const rows = listRows()
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book' }),
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('shows application status actions for pending provider applicants', async () => {
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue({
      id: 'app_pending_12345678',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'PENDING',
      skills: [],
      serviceAreas: [],
      experience: null,
      availability: null,
      providerId: null,
      submittedAt: new Date(),
    } as any)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('under review')
    expect(body).toContain('12345678')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_application_status' }),
      expect.objectContaining({ id: 'provider_update_application' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('shows provider operations for approved active providers', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: ['plumbing'],
      serviceAreas: ['Bromhof'],
    } as any)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('Welcome back, Jacob')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_available_jobs' }),
      expect.objectContaining({ id: 'provider_my_jobs' }),
      expect.objectContaining({ id: 'provider_check_status' }),
      expect.objectContaining({ id: 'provider_pause_leads' }),
      expect.objectContaining({ id: 'provider_worker_portal' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('highlights active jobs for approved providers', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: [],
      serviceAreas: [],
    } as any)
    vi.mocked(db.job.count).mockResolvedValue(2)

    await showMainMenu(PHONE)

    expect(vi.mocked(wa.sendList).mock.calls[0][1]).toContain('2 active jobs')
  })

  it('shows inactive provider status actions without available leads', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'SUSPENDED',
      active: false,
      verified: true,
      availableNow: false,
      suspendedUntil: null,
      suspendedReason: 'Manual review',
      skills: [],
      serviceAreas: [],
    } as any)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('currently inactive')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_status' }),
      expect.objectContaining({ id: 'provider_support' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_available_jobs' }),
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('normalizes SA phone numbers before provider lookup', async () => {
    await showMainMenu('0823035070')

    expect(db.provider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone: { in: expect.arrayContaining(['+27823035070', '27823035070', '0823035070']) },
        },
      }),
    )
  })

  it('prevents duplicate registration when stale Find Work reaches an existing provider', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      availableNow: true,
    } as any)

    const result = await handleRegistrationFlow({
      phone: PHONE,
      step: 'reg_start',
      flow: 'registration',
      data: {},
      reply: { type: 'button', id: 'find_work' },
    } as any)

    expect(result.nextStep).toBe('pj_toggle_available')
    expect(db.providerApplication.create).not.toHaveBeenCalled()
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("you're already registered"),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_my_jobs' }),
      ]),
    )
  })
})
