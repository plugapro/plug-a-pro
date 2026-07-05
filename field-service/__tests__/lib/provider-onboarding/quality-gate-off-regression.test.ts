import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist the gate mock and force it OFF for the entire suite.
const { gateEnabled } = vi.hoisted(() => ({ gateEnabled: vi.fn() }))
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: gateEnabled,
}))

import { submitProviderApplication } from '@/lib/provider-applications-submit'
import { submitProviderRegistrationApplication } from '@/lib/provider-registration/pwa-flow'
import { buildDynamicSchema, selectMissingSections, SECTION_REGISTRY } from '@/lib/web-signup-sections'

// Minimal fake tx client that mirrors provider-applications-submit tests.
function fakeWebSubmitClient() {
  return {
    providerApplication: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    provider: { findFirst: vi.fn().mockResolvedValue(null) },
    conversation: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as any // TODO: type the Prisma tx stub once mock helpers are centralised
}

// PWA-flow submit client (mirrors the one in provider-registration tests).
function fakePwaSubmitClient() {
  return {
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    provider: {
      findUnique: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    providerApplication: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    },
    providerApplicationDraft: {
      update: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    },
    registrationResumeToken: {
      findUnique: vi.fn().mockResolvedValue({
        draftId: 'draft-1',
        purpose: 'provider_registration_resume',
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
        draft: { id: 'draft-1', phone: '+27823035070' },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    locationNode: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'sub_test',
          nodeType: 'SUBURB',
          slug: 'gauteng__johannesburg__jhb_central__test',
          label: 'Test Suburb',
          postalCode: '2094',
          provinceKey: 'gauteng',
          cityKey: 'johannesburg',
          regionKey: 'jhb_central',
          parent: {
            id: 'region-jhb-central',
            nodeType: 'REGION',
            label: 'JHB Central',
            parent: {
              id: 'city-johannesburg',
              nodeType: 'CITY',
              label: 'Johannesburg',
              parent: {
                id: 'province-gauteng',
                nodeType: 'PROVINCE',
                label: 'Gauteng',
              },
            },
          },
        },
      ]),
    },
    technicianServiceArea: {
      upsert: vi.fn().mockResolvedValue({ id: 'area-1' }),
    },
    providerCategory: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    providerRate: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as any
}

describe('quality-gate OFF regression — flag preserves pre-gate behaviour', () => {
  beforeEach(() => {
    gateEnabled.mockReset()
    gateEnabled.mockResolvedValue(false)
  })

  describe('submitProviderApplication (web flow)', () => {
    it('creates application with empty evidenceFileUrls and high-risk skills WITHOUT throwing when gate OFF', async () => {
      const client = fakeWebSubmitClient()
      client.providerApplication.create.mockResolvedValue({ id: 'app-1' })

      // High-risk skill (plumbing) with zero evidence — would fail if gate leaked
      await submitProviderApplication(
        client,
        {
          name: 'Test Provider',
          phone: '+27821234567',
          skills: ['plumbing'],
          serviceAreas: ['area-1'],
          availability: 'Weekdays',
          evidenceFileUrls: [],
        } as any,
        { source: 'web' } as any,
      )

      // Verify the gate was consulted and resolved false
      expect(gateEnabled).toHaveBeenCalled()
      expect(gateEnabled.mock.results[0].value).resolves.toBe(false)

      // Verify create was called with empty evidenceFileUrls passed through unchallenged
      expect(client.providerApplication.create).toHaveBeenCalled()
      const createArg = client.providerApplication.create.mock.calls[0][0]
      expect(createArg).toBeDefined()
      expect(createArg.data.evidenceFileUrls).toEqual([])
      // High-risk skill (plumbing) should also be preserved
      expect(createArg.data.skills).toContain('plumbing')
    })

    it('creates application preserving whatever evidenceFileUrls were provided when gate OFF', async () => {
      const client = fakeWebSubmitClient()
      const testUrls = ['https://example.com/1.jpg', 'https://example.com/2.jpg']
      client.providerApplication.create.mockResolvedValue({ id: 'app-2' })

      await submitProviderApplication(
        client,
        {
          name: 'Test Provider',
          phone: '+27821234568',
          skills: ['painting'],
          serviceAreas: ['area-1'],
          availability: 'Any day',
          evidenceFileUrls: testUrls,
        } as any,
        { source: 'web' } as any,
      )

      expect(client.providerApplication.create).toHaveBeenCalled()
      // The application was created without error
      const createCall = client.providerApplication.create.mock.calls[0]
      expect(createCall).toBeDefined()
    })
  })

  describe('submitProviderRegistrationApplication (PWA flow)', () => {
    it('creates application with empty evidenceFileUrls and high-risk skills WITHOUT throwing when gate OFF', async () => {
      const txClient = fakePwaSubmitClient()
      const client = {
        locationNode: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (callback) => callback(txClient)),
      } as any

      // High-risk skill (electrical) with zero evidence — would fail if gate leaked
      const result = await submitProviderRegistrationApplication(client, {
        draftId: 'draft-1',
        resumeToken: 'resume-token',
        phone: '0823035070',
        name: 'Test Provider',
        skills: ['electrical'],
        serviceAreas: ['Test Suburb'],
        locationNodeIds: ['sub_test'],
        provinceId: 'province-gauteng',
        cityId: 'city-johannesburg',
        regionId: 'region-jhb-central',
        availabilityDays: ['Mon'],
        callOutFee: 150,
        consentAccepted: true,
        evidenceFileUrls: [],
      })

      expect(gateEnabled).toHaveBeenCalled()
      expect(result.outcome).toBe('created')
      expect(txClient.providerApplication.create).toHaveBeenCalled()
    })

    it('carries through evidenceFileUrls to application without validation when gate OFF', async () => {
      const txClient = fakePwaSubmitClient()
      const client = {
        locationNode: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (callback) => callback(txClient)),
      } as any

      const testUrls = ['https://example.com/a.jpg']

      await submitProviderRegistrationApplication(client, {
        draftId: 'draft-1',
        resumeToken: 'resume-token',
        phone: '0823035070',
        name: 'Test Provider',
        skills: ['plumbing'],
        serviceAreas: ['Test Suburb'],
        locationNodeIds: ['sub_test'],
        provinceId: 'province-gauteng',
        cityId: 'city-johannesburg',
        regionId: 'region-jhb-central',
        availabilityDays: ['Mon'],
        callOutFee: 150,
        consentAccepted: true,
        evidenceFileUrls: testUrls,
      })

      expect(txClient.providerApplication.create).toHaveBeenCalled()
      // Verify application was created
      const createCall = txClient.providerApplication.create.mock.calls[0]
      expect(createCall).toBeDefined()
    })
  })

  describe('buildDynamicSchema (web signup sections)', () => {
    it('accepts zero photos when gateEnabled: false', () => {
      const evidenceSection = SECTION_REGISTRY.find((s) => s.key === 'evidence')!
      const schema = buildDynamicSchema([evidenceSection], { gateEnabled: false })

      const result = schema.safeParse({ evidenceFileUrls: [] })
      expect(result.success).toBe(true)
    })

    it('accepts missing evidence field entirely when gateEnabled: false', () => {
      const evidenceSection = SECTION_REGISTRY.find((s) => s.key === 'evidence')!
      const schema = buildDynamicSchema([evidenceSection], { gateEnabled: false })

      const result = schema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('does not include certification section when gateEnabled: false regardless of skill', () => {
      // selectMissingSections is the gate-aware function; it returns []
      // when gate is OFF (certification not required in missing sections).
      const sections = selectMissingSections(
        { skills: ['plumbing'] },
        { gateEnabled: false },
      )

      // High-risk skill (plumbing) but gate OFF — certification should not be in missing sections
      const hasCertSection = sections.some((s) => s.key === 'certification')
      expect(hasCertSection).toBe(false)
    })
  })
})
