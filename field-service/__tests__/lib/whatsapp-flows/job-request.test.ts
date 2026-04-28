// ─── WhatsApp customer job-request flow — structured address tests ─────────────
// Covers:
//  1. Province selection: list-based, rejects typed text
//  2. City selection: filtered by province, out-of-area waitlists immediately
//  3. Region selection: filtered by city
//  4. Suburb selection: filtered by region, derives postalCode + locationNodeId
//  5. Submission: uses resolveStructuredAddressCapture, passes all fields to createJobRequest
//  6. Returning customer with structured address can reuse it
//  7. Returning customer with legacy address is forced through new structured flow
//  8. Pagination: lists > 10 rows are paged correctly
//  9. Typed replies on structured steps are rejected, list is resent
// 10. No new flow path relies on resolveSuburbNodeId or manual suburb/city capture

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    customer: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    address: {
      findFirst: vi.fn(),
    },
    jobRequest: {
      findFirst: vi.fn().mockResolvedValue(null), // default: no existing active request
      update: vi.fn().mockResolvedValue({}),
    },
    attachment: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
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
  resolveSuburbNodeId: vi.fn(), // should NOT be called by new flow
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('msg-1'),
  sendButtons: vi.fn().mockResolvedValue('msg-2'),
  sendList: vi.fn().mockResolvedValue('msg-3'),
  sendCtaUrl: vi.fn().mockResolvedValue('msg-4'),
}))

vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn().mockReturnValue(true),
  isActiveCity: vi.fn().mockReturnValue(true),
  isActiveRegion: vi.fn().mockReturnValue(true),
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/job-requests/create-job-request', () => ({
  createJobRequest: vi.fn(),
}))

vi.mock('@/lib/structured-address', () => ({
  resolveStructuredAddressCapture: vi.fn(),
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {
    constructor(msg: string) { super(msg); this.name = 'InvalidStructuredAddressError' }
  },
}))

vi.mock('@/lib/category-config', () => ({
  resolveCategoryRequirements: vi.fn().mockResolvedValue({
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    policy: { bookingOnAssignment: false, regulated: false },
  }),
}))

import { handleJobRequestFlow } from '@/lib/whatsapp-flows/job-request'
import * as locationNodes from '@/lib/location-nodes'
import * as wa from '@/lib/whatsapp-interactive'
import * as serviceAreaGuard from '@/lib/service-area-guard'
import * as structuredAddress from '@/lib/structured-address'
import * as createJobRequestModule from '@/lib/job-requests/create-job-request'
import * as whatsappMedia from '@/lib/whatsapp-media'
import { db } from '@/lib/db'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PHONE = '+27821234567'

const PROVINCES = [
  { id: 'prov_gauteng', slug: 'gauteng', label: 'Gauteng' },
  { id: 'prov_wc', slug: 'western_cape', label: 'Western Cape' },
]

const CITIES_GAUTENG = [
  { id: 'city_jhb', slug: 'gauteng__johannesburg', label: 'Johannesburg', provinceKey: 'gauteng', cityKey: 'johannesburg' },
  { id: 'city_pta', slug: 'gauteng__pretoria', label: 'Pretoria', provinceKey: 'gauteng', cityKey: 'pretoria' },
]

const CITIES_WC = [
  { id: 'city_cpt', slug: 'western_cape__cape_town', label: 'Cape Town', provinceKey: 'western_cape', cityKey: 'cape_town' },
]

const REGIONS_JHB = [
  { id: 'rgn_north', slug: 'gauteng__johannesburg__jhb_north', label: 'JHB North', provinceKey: 'gauteng', cityKey: 'johannesburg', regionKey: 'jhb_north', lat: null, lng: null, radiusKm: null },
  { id: 'rgn_south', slug: 'gauteng__johannesburg__jhb_south', label: 'JHB South', provinceKey: 'gauteng', cityKey: 'johannesburg', regionKey: 'jhb_south', lat: null, lng: null, radiusKm: null },
]

const SUBURBS_JHB_NORTH = [
  { id: 'sub_sandton', slug: '...sandton', label: 'Sandton', regionLabel: 'JHB North', cityLabel: 'Johannesburg', provinceLabel: 'Gauteng', postalCode: '2196', provinceKey: 'gauteng', cityKey: 'johannesburg', regionKey: 'jhb_north', lat: null, lng: null },
  { id: 'sub_fourways', slug: '...fourways', label: 'Fourways', regionLabel: 'JHB North', cityLabel: 'Johannesburg', provinceLabel: 'Gauteng', postalCode: '2068', provinceKey: 'gauteng', cityKey: 'johannesburg', regionKey: 'jhb_north', lat: null, lng: null },
]

const SANDTON_SELECTION = {
  locationNodeId: 'sub_sandton',
  suburb: 'Sandton',
  region: 'JHB North',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '2196',
}

function makeCtx(
  step: string,
  replyId?: string,
  replyText?: string,
  data: object = {},
) {
  return {
    phone: PHONE,
    step: step as any,
    data: data as any,
    flow: 'job_request' as const,
    reply: {
      type: (replyId ? 'list_reply' : 'text') as any,
      id: replyId,
      text: replyText,
      title: replyId,
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WhatsApp job-request flow — structured address', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(locationNodes.getProvinces as any).mockResolvedValue(PROVINCES)
    ;(locationNodes.getCities as any).mockResolvedValue(CITIES_GAUTENG)
    ;(locationNodes.getRegions as any).mockResolvedValue(REGIONS_JHB)
    ;(locationNodes.getSuburbs as any).mockResolvedValue(SUBURBS_JHB_NORTH)
    ;(locationNodes.getStructuredAddressSelection as any).mockResolvedValue(SANDTON_SELECTION)
    ;(serviceAreaGuard.isInActiveServiceArea as any).mockReturnValue(true)
  })

  // ── 1. Province selection ──────────────────────────────────────────────────

  describe('collect_address_street → addr_select_province', () => {
    it('transitions to addr_select_province after street capture', async () => {
      const result = await handleJobRequestFlow(makeCtx('collect_address_street', undefined, '14 Main Road'))

      expect(result.nextStep).toBe('addr_select_province')
      expect(result.nextData).toMatchObject({ addressLine1: '14 Main Road', addressStreet: '14 Main Road', addrPage: 0 })
      expect(wa.sendList).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('province'),
        expect.arrayContaining([expect.objectContaining({ rows: expect.any(Array) })]),
        expect.any(Object),
      )
    })
  })

  describe('addr_select_province', () => {
    it('rejects typed text and resends province list', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_province', undefined, 'Gauteng'))

      expect(result.nextStep).toBe('addr_select_province')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('choose from the list'))
      // Province list must be resent
      expect(wa.sendList).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('province'),
        expect.any(Array),
        expect.any(Object),
      )
    })

    it('accepts a valid province selection and shows city list', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_province', 'prov__gauteng'))

      expect(result.nextStep).toBe('addr_select_city')
      expect(result.nextData).toMatchObject({ addrProvinceKey: 'gauteng', addrProvinceLabel: 'Gauteng', addrPage: 0 })
      expect(locationNodes.getCities).toHaveBeenCalledWith('gauteng')
      expect(wa.sendList).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Gauteng'),
        expect.any(Array),
        expect.any(Object),
      )
    })

    it('rejects an unknown province ID and resends province list', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_province', 'prov__unknown_province'))

      expect(result.nextStep).toBe('addr_select_province')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('choose from the list'))
    })
  })

  // ── 2. City selection filtered by province ────────────────────────────────

  describe('addr_select_city', () => {
    const baseData = { addrProvinceKey: 'gauteng', addrProvinceLabel: 'Gauteng', addrPage: 0 }

    it('shows cities filtered by the selected province', async () => {
      await handleJobRequestFlow(makeCtx('addr_select_city', 'city__city_jhb', undefined, baseData))

      expect(locationNodes.getCities).toHaveBeenCalledWith('gauteng')
    })

    it('rejects typed text and resends city list', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_city', undefined, 'Johannesburg', baseData))

      expect(result.nextStep).toBe('addr_select_city')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('choose from the list'))
      expect(wa.sendList).toHaveBeenCalledWith(PHONE, expect.stringContaining('Gauteng'), expect.any(Array), expect.any(Object))
    })

    it('waitlists and returns done for an out-of-area city', async () => {
      ;(serviceAreaGuard.isInActiveServiceArea as any).mockReturnValue(false)
      ;(locationNodes.getCities as any).mockResolvedValue(CITIES_WC)

      const result = await handleJobRequestFlow(
        makeCtx('addr_select_city', 'city__city_cpt', undefined, {
          addrProvinceKey: 'western_cape',
          addrProvinceLabel: 'Western Cape',
          addrPage: 0,
          customerName: 'Sipho',
          selectedCategory: 'Plumbing',
        })
      )

      expect(result.nextStep).toBe('done')
      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ phone: PHONE, city: 'Cape Town', province: 'Western Cape' })
      )
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Cape Town'))
    })

    it('shows region list for an active city', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_city', 'city__city_jhb', undefined, baseData))

      expect(result.nextStep).toBe('addr_select_region')
      expect(result.nextData).toMatchObject({ addrCityId: 'city_jhb', addrCityLabel: 'Johannesburg', addrPage: 0 })
      expect(locationNodes.getRegions).toHaveBeenCalledWith('city_jhb')
    })
  })

  // ── 3. Region selection filtered by city ─────────────────────────────────

  describe('addr_select_region', () => {
    const baseData = { addrCityId: 'city_jhb', addrCityLabel: 'Johannesburg', addrPage: 0 }

    it('shows regions filtered by city', async () => {
      await handleJobRequestFlow(makeCtx('addr_select_region', 'rgn__rgn_north', undefined, baseData))

      expect(locationNodes.getRegions).toHaveBeenCalledWith('city_jhb')
    })

    it('rejects typed text and resends region list', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_region', undefined, 'JHB North', baseData))

      expect(result.nextStep).toBe('addr_select_region')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('choose from the list'))
      expect(wa.sendList).toHaveBeenCalledWith(PHONE, expect.stringContaining('Johannesburg'), expect.any(Array), expect.any(Object))
    })

    it('transitions to addr_select_suburb on valid region selection', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_region', 'rgn__rgn_north', undefined, baseData))

      expect(result.nextStep).toBe('addr_select_suburb')
      expect(result.nextData).toMatchObject({ addrRegionId: 'rgn_north', addrRegionLabel: 'JHB North', addrPage: 0 })
    })
  })

  // ── 4. Suburb selection — derives postalCode + locationNodeId ─────────────

  describe('addr_select_suburb', () => {
    const baseData = {
      addrRegionId: 'rgn_north',
      addrRegionLabel: 'JHB North',
      addrPage: 0,
      addressLine1: '14 Main Road',
    }

    it('resolves the selected suburb by node ID (filtered by region context)', async () => {
      await handleJobRequestFlow(makeCtx('addr_select_suburb', 'sub__sub_sandton', undefined, baseData))

      // On selection we resolve by node ID (not by re-fetching the full list)
      expect(locationNodes.getStructuredAddressSelection).toHaveBeenCalledWith('sub_sandton')
    })

    it('rejects typed text and resends suburb list', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_suburb', undefined, 'Sandton', baseData))

      expect(result.nextStep).toBe('addr_select_suburb')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('choose from the list'))
      expect(wa.sendList).toHaveBeenCalledWith(PHONE, expect.stringContaining('JHB North'), expect.any(Array), expect.any(Object))
    })

    it('derives postalCode and locationNodeId from the suburb node, never from typed input', async () => {
      const result = await handleJobRequestFlow(makeCtx('addr_select_suburb', 'sub__sub_sandton', undefined, baseData))

      expect(result.nextStep).toBe('addr_confirm')
      expect(result.nextData).toMatchObject({
        addrLocationNodeId: 'sub_sandton',
        addrSuburbLabel: 'Sandton',
        addrPostalCode: '2196',
        addrCityLabel: 'Johannesburg',
        addrProvinceLabel: 'Gauteng',
      })
      // Confirmation message must show derived postalCode, not any typed value
      expect(wa.sendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('2196'),
        expect.any(Array),
      )
    })

    it('shows full address confirmation after suburb selection', async () => {
      await handleJobRequestFlow(makeCtx('addr_select_suburb', 'sub__sub_sandton', undefined, baseData))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('14 Main Road'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'addr_yes' }),
          expect.objectContaining({ id: 'addr_no' }),
        ]),
      )
    })
  })

  // ── 5. Submission uses resolveStructuredAddressCapture ────────────────────

  describe('job_request_submitted — structured path', () => {
    const structuredData = {
      addrLocationNodeId: 'sub_sandton',
      addressLine1: '14 Main Road',
      customerName: 'Thabo',
      selectedCategory: 'Plumbing',
      category: 'Plumbing',
      availabilityNote: 'As soon as possible',
      address: '14 Main Road, Sandton, JHB North, Johannesburg',
    }

    const resolvedAddr = {
      street: '14 Main Road',
      addressLine1: '14 Main Road',
      addressLine2: null,
      complexName: null,
      unitNumber: null,
      suburb: 'Sandton',
      region: 'JHB North',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      locationNodeId: 'sub_sandton',
    }

    beforeEach(() => {
      ;(structuredAddress.resolveStructuredAddressCapture as any).mockResolvedValue(resolvedAddr)
      ;(createJobRequestModule.createJobRequest as any).mockResolvedValue({
        jobRequestId: 'jr_test123456',
        customerId: 'cust_001',
        ticketUrl: null,
      })
    })

    it('calls resolveStructuredAddressCapture with addressLine1 and locationNodeId', async () => {
      await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(structuredAddress.resolveStructuredAddressCapture).toHaveBeenCalledWith(
        expect.objectContaining({ addressLine1: '14 Main Road', locationNodeId: 'sub_sandton' })
      )
    })

    it('passes all structured fields to createJobRequest', async () => {
      await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(createJobRequestModule.createJobRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          street: '14 Main Road',
          addressLine1: '14 Main Road',
          suburb: 'Sandton',
          region: 'JHB North',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '2196',
          locationNodeId: 'sub_sandton',
        })
      )
    })

    it('falls back to re-entering address when resolveStructuredAddressCapture throws InvalidStructuredAddressError', async () => {
      ;(structuredAddress.resolveStructuredAddressCapture as any).mockRejectedValue(
        new (structuredAddress as any).InvalidStructuredAddressError('invalid node'),
      )

      const result = await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(result.nextStep).toBe('collect_address_street')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('could not validate'))
    })

    it('does NOT call resolveSuburbNodeId anywhere in the new flow', async () => {
      await handleJobRequestFlow(makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData))

      expect(locationNodes.resolveSuburbNodeId).not.toHaveBeenCalled()
    })

    it('backfills every uploaded customer photo onto the created job request', async () => {
      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, {
          ...structuredData,
          photoAttachmentIds: ['att_001', 'att_002', 'att_003'],
        })
      )

      expect(db.attachment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['att_001', 'att_002', 'att_003'] }, jobRequestId: null },
        data: { jobRequestId: 'jr_test123456' },
      })
    })

    it('falls back to status buttons when ticket CTA delivery fails after a successful submission', async () => {
      ;(createJobRequestModule.createJobRequest as any).mockResolvedValue({
        jobRequestId: 'jr_test123456',
        customerId: 'cust_001',
        ticketUrl: 'https://app.plugapro.co.za/requests/access/test-token',
      })
      ;(wa.sendCtaUrl as any).mockRejectedValueOnce(new Error('Meta rejected CTA'))

      const result = await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(result.nextStep).toBe('done')
      expect(wa.sendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Request submitted'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'status' }),
          expect.objectContaining({ id: 'back_home' }),
        ]),
      )
    })
  })

  // ── 6. Returning customer with structured address can reuse it ────────────

  describe('returning customer — structured saved address', () => {
    beforeEach(() => {
      ;(db.customer.findUnique as any).mockResolvedValue({ id: 'cust_1', name: 'Zanele' })
      ;(db.address.findFirst as any).mockResolvedValue({
        id: 'addr_1',
        street: '14 Main Road, Sandton',
        addressLine1: '14 Main Road',
        suburb: 'Sandton',
        city: 'Johannesburg',
        locationNodeId: 'sub_sandton',
      })
    })

    it('offers Same address button when locationNodeId is set', async () => {
      const result = await handleJobRequestFlow(makeCtx('collect_name', 'cat_plumbing'))

      expect(locationNodes.getStructuredAddressSelection).toHaveBeenCalledWith('sub_sandton')
      expect(wa.sendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Last used'),
        expect.arrayContaining([expect.objectContaining({ id: 'addr_same' })]),
      )
      expect(result.nextStep).toBe('collect_address')
      expect(result.nextData).toMatchObject({ addrLocationNodeId: 'sub_sandton' })
    })

    it('carries addrLocationNodeId through addr_same → availability', async () => {
      const result = await handleJobRequestFlow(
        makeCtx('collect_address', 'addr_same', undefined, {
          addrLocationNodeId: 'sub_sandton',
          address: '14 Main Road, Sandton, Johannesburg',
        })
      )

      // Should jump straight to availability (nextStep: confirm_job_request)
      expect(result.nextStep).toBe('confirm_job_request')
    })
  })

  // ── 7. Returning customer with legacy address → forced new structured flow ─

  describe('returning customer — legacy address (no locationNodeId)', () => {
    beforeEach(() => {
      ;(db.customer.findUnique as any).mockResolvedValue({ id: 'cust_2', name: 'Sipho' })
      ;(db.address.findFirst as any).mockResolvedValue({
        id: 'addr_old',
        street: 'Old Street, Soweto',
        suburb: 'Soweto',
        city: 'Johannesburg',
        locationNodeId: null,   // legacy — no structured node
      })
    })

    it('does NOT offer Same address and goes straight to street entry', async () => {
      const result = await handleJobRequestFlow(makeCtx('collect_name', 'cat_handyman'))

      expect(wa.sendButtons).not.toHaveBeenCalled()
      expect(result.nextStep).toBe('collect_address_street')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Street address'))
    })
  })

  // ── 8. Pagination works for lists > 10 rows ───────────────────────────────

  describe('pagination', () => {
    it('shows 8 items + Next on page 0 when suburb list > 10', async () => {
      const manySuburbs = Array.from({ length: 12 }, (_, i) => ({
        id: `sub_${i}`,
        slug: `slug_${i}`,
        label: `Suburb ${i}`,
        regionLabel: 'JHB North',
        cityLabel: 'Johannesburg',
        provinceLabel: 'Gauteng',
        postalCode: `200${i}`,
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_north',
        lat: null,
        lng: null,
      }))
      ;(locationNodes.getSuburbs as any).mockResolvedValue(manySuburbs)

      await handleJobRequestFlow(
        makeCtx('addr_select_suburb', undefined, 'suburb', {
          addrRegionId: 'rgn_north',
          addrRegionLabel: 'JHB North',
          addrPage: 0,
        })
      )

      // Rejection text + resend with paged list
      const listCall = (wa.sendList as any).mock.calls.find((call: any[]) =>
        call[1]?.includes('JHB North')
      )
      expect(listCall).toBeDefined()
      const rows = listCall[2][0].rows
      // 8 data rows + 1 next nav = 9 total
      expect(rows).toHaveLength(9)
      expect(rows[rows.length - 1].id).toBe('sub_next')
    })

    it('shows remaining items + Previous on last page', async () => {
      const manySuburbs = Array.from({ length: 12 }, (_, i) => ({
        id: `sub_${i}`,
        slug: `slug_${i}`,
        label: `Suburb ${i}`,
        regionLabel: 'JHB North',
        cityLabel: 'Johannesburg',
        provinceLabel: 'Gauteng',
        postalCode: `200${i}`,
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_north',
        lat: null,
        lng: null,
      }))
      ;(locationNodes.getSuburbs as any).mockResolvedValue(manySuburbs)

      await handleJobRequestFlow(
        makeCtx('addr_select_suburb', 'sub_next', undefined, {
          addrRegionId: 'rgn_north',
          addrRegionLabel: 'JHB North',
          addrPage: 0,
        })
      )

      const listCall = (wa.sendList as any).mock.calls.find((call: any[]) =>
        call[1]?.includes('JHB North')
      )
      const rows = listCall[2][0].rows
      // 4 data rows (items 8-11) + 1 prev nav = 5 total
      expect(rows).toHaveLength(5)
      expect(rows[rows.length - 1].id).toBe('sub_prev')
    })

    it('paginates city list when cities > 10', async () => {
      const manyCities = Array.from({ length: 11 }, (_, i) => ({
        id: `city_${i}`,
        slug: `gauteng__city_${i}`,
        label: `City ${i}`,
        provinceKey: 'gauteng',
        cityKey: `city_${i}`,
      }))
      ;(locationNodes.getCities as any).mockResolvedValue(manyCities)

      // Simulate city_next tap on page 0
      await handleJobRequestFlow(
        makeCtx('addr_select_city', 'city_next', undefined, {
          addrProvinceKey: 'gauteng',
          addrProvinceLabel: 'Gauteng',
          addrPage: 0,
        })
      )

      expect(wa.sendList).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Gauteng'),
        expect.any(Array),
        expect.any(Object),
      )
    })
  })

  // ── 9. Typed replies during structured steps are rejected ─────────────────

  describe('typed reply rejection on all structured steps', () => {
    it.each([
      ['addr_select_province', { addrPage: 0 }],
      ['addr_select_city', { addrProvinceKey: 'gauteng', addrProvinceLabel: 'Gauteng', addrPage: 0 }],
      ['addr_select_region', { addrCityId: 'city_jhb', addrCityLabel: 'Johannesburg', addrPage: 0 }],
      ['addr_select_suburb', { addrRegionId: 'rgn_north', addrRegionLabel: 'JHB North', addrPage: 0, addressLine1: '14 Main Road' }],
    ])('step %s rejects typed text and stays on same step', async (step, data) => {
      const result = await handleJobRequestFlow(makeCtx(step, undefined, 'some typed text', data))

      expect(result.nextStep).toBe(step)
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('choose from the list'))
      // List must be resent
      expect(wa.sendList).toHaveBeenCalled()
    })
  })

  // ── Legacy steps redirect to new flow ─────────────────────────────────────

  describe('legacy steps', () => {
    it('collect_address_suburb redirects to addr_select_province', async () => {
      const result = await handleJobRequestFlow(makeCtx('collect_address_suburb', undefined, 'Sandton'))

      expect(result.nextStep).toBe('addr_select_province')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('updated'))
      expect(wa.sendList).toHaveBeenCalled()
    })

    it('confirm_address for out-of-area city still waitlists via legacy handler', async () => {
      ;(serviceAreaGuard.isInActiveServiceArea as any).mockReturnValue(false)

      const result = await handleJobRequestFlow(
        makeCtx('confirm_address', undefined, 'Cape Town', {
          customerName: 'Sipho',
          addressSuburb: 'Sea Point',
        })
      )

      expect(result.nextStep).toBe('done')
      expect(serviceAreaGuard.addToServiceAreaWaitlist).toHaveBeenCalled()
    })

    it('confirm_address for active city redirects to addr_select_province', async () => {
      ;(serviceAreaGuard.isInActiveServiceArea as any).mockReturnValue(true)

      const result = await handleJobRequestFlow(
        makeCtx('confirm_address', undefined, 'Johannesburg', { addressSuburb: 'Sandton' })
      )

      expect(result.nextStep).toBe('addr_select_province')
    })
  })

  // ── 11. Dedup guard — retry after DB-success / message-fail ───────────────

  describe('dedup guard — existing active job request', () => {
    const structuredData = {
      category: 'cat_plumbing',
      selectedCategory: 'Plumbing',
      addrLocationNodeId: 'sub_sandton',
      addressLine1: '14 Main Road',
      address: '14 Main Road, Sandton, JHB North, Johannesburg, Gauteng 2196',
      availabilityNote: 'As soon as possible',
    }

    beforeEach(() => {
      ;(structuredAddress.resolveStructuredAddressCapture as any).mockResolvedValue({
        street: '14 Main Road, Sandton',
        addressLine1: '14 Main Road',
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Sandton',
        region: 'JHB North',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2196',
        locationNodeId: 'sub_sandton',
      })
    })

    it('returns done without calling createJobRequest when an active request exists', async () => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue({
        id: 'jr_existing1234',
        description: 'Preferred availability: As soon as possible',
        status: 'OPEN',
        customerId: 'cust_001',
      })

      const result = await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(createJobRequestModule.createJobRequest).not.toHaveBeenCalled()
      expect(result.nextStep).toBe('done')
      expect(result.nextData).toMatchObject({
        jobRequestId: 'jr_existing1234',
        customerId: 'cust_001',
      })
    })

    it('sends the "already received" message when an active request is detected', async () => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue({
        id: 'jr_existing1234',
        description: 'Preferred availability: As soon as possible',
        status: 'OPEN',
        customerId: 'cust_001',
      })

      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining("You have an active")
      )
      // Ref should be the last 8 chars of 'jr_existing1234' uppercased → TING1234
      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('TING1234')
      )
    })

    it('mentions provider-searching status line for OPEN status', async () => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue({
        id: 'jr_abc12345',
        description: '',
        status: 'OPEN',
        customerId: 'cust_001',
      })

      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('still searching')
      )
    })

    it('mentions providers-notified status line for MATCHING status', async () => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue({
        id: 'jr_abc12345',
        description: '',
        status: 'MATCHING',
        customerId: 'cust_001',
      })

      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining("We've notified nearby providers")
      )
    })

    it('updates description when availability note differs from existing', async () => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue({
        id: 'jr_existing1234',
        description: 'Preferred availability: This week',  // old note
        status: 'OPEN',
        customerId: 'cust_001',
      })

      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, {
          ...structuredData,
          availabilityNote: 'This weekend',  // new note differs
        })
      )

      expect(db.jobRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'jr_existing1234' },
          data: { description: 'Preferred availability: This weekend' },
        })
      )
    })

    it('does NOT call update when description is unchanged', async () => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue({
        id: 'jr_existing1234',
        description: 'Preferred availability: As soon as possible',
        status: 'OPEN',
        customerId: 'cust_001',
      })

      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(db.jobRequest.update).not.toHaveBeenCalled()
    })
  })

  // ── 12. Pilot debug errors (PILOT_DEBUG_ERRORS=true) ─────────────────────

  describe('pilot debug error suffix', () => {
    const structuredData = {
      category: 'cat_plumbing',
      selectedCategory: 'Plumbing',
      addrLocationNodeId: 'sub_sandton',
      addressLine1: '14 Main Road',
      address: '14 Main Road, Sandton, Johannesburg',
      availabilityNote: 'As soon as possible',
    }

    beforeEach(() => {
      ;(db.jobRequest.findFirst as any).mockResolvedValue(null) // no existing active request
      ;(structuredAddress.resolveStructuredAddressCapture as any).mockResolvedValue({
        street: '14 Main Road, Sandton',
        addressLine1: '14 Main Road',
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Sandton',
        region: 'JHB North',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2196',
        locationNodeId: 'sub_sandton',
      })
      ;(createJobRequestModule.createJobRequest as any).mockRejectedValue(
        new Error('DB connection refused')
      )
    })

    it('appends technical error to WhatsApp message when PILOT_DEBUG_ERRORS=true', async () => {
      const original = process.env.PILOT_DEBUG_ERRORS
      process.env.PILOT_DEBUG_ERRORS = 'true'
      try {
        await handleJobRequestFlow(
          makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
        )

        expect(wa.sendText).toHaveBeenCalledWith(
          PHONE,
          expect.stringContaining('DB connection refused')
        )
        expect(wa.sendText).toHaveBeenCalledWith(
          PHONE,
          expect.stringContaining('🔧 Debug:')
        )
      } finally {
        process.env.PILOT_DEBUG_ERRORS = original
      }
    })

    it('does NOT append debug info when PILOT_DEBUG_ERRORS is not set', async () => {
      const original = process.env.PILOT_DEBUG_ERRORS
      delete process.env.PILOT_DEBUG_ERRORS
      try {
        await handleJobRequestFlow(
          makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
        )

        const sendTextCall = (wa.sendText as any).mock.calls[0]
        expect(sendTextCall[1]).not.toContain('🔧 Debug:')
        expect(sendTextCall[1]).not.toContain('DB connection refused')
      } finally {
        process.env.PILOT_DEBUG_ERRORS = original
      }
    })

    it('still sends the user-friendly error message in both cases', async () => {
      await handleJobRequestFlow(
        makeCtx('job_request_submitted', 'confirm_yes', undefined, structuredData)
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Something went wrong submitting your request')
      )
    })
  })
})

// ─── collect_photos step ──────────────────────────────────────────────────────

describe('WhatsApp job-request flow — collect_photos step', () => {
  // Shared conversation data that mimics state after availability is selected
  const baseData = {
    selectedCategory: 'Plumbing',
    address: '14 Main Rd, Sandton, Johannesburg',
    availabilityNote: 'As soon as possible',
    photoAttachmentIds: [] as string[],
  }

  function makePhotoCtx(
    replyId?: string,
    replyText?: string,
    data: object = baseData,
    type: 'button_reply' | 'text' | 'image' | 'document' = replyId ? 'button_reply' : 'text',
    mediaId?: string,
  ) {
    return {
      phone: PHONE,
      step: 'collect_photos' as any,
      data: data as any,
      flow: 'job_request' as const,
      reply: { type, id: replyId, text: replyText, title: replyId, mediaId } as any,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows photo prompt and confirmation summary when photos_skip is tapped', async () => {
    const result = await handleJobRequestFlow(makePhotoCtx('photos_skip'))
    expect(result.nextStep).toBe('job_request_submitted')
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Job Request Summary'),
      expect.arrayContaining([expect.objectContaining({ id: 'confirm_yes' })])
    )
    // No "Photos attached" line when skipped
    const body: string = (wa.sendButtons as any).mock.calls[0][1]
    expect(body).not.toContain('Photos:')
  })

  it('proceeds to confirmation when "skip" is typed as free text', async () => {
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, 'skip'))
    expect(result.nextStep).toBe('job_request_submitted')
    expect(wa.sendButtons).toHaveBeenCalledWith(PHONE, expect.stringContaining('Job Request Summary'), expect.any(Array))
  })

  it('instructs user to send a photo when photos_start is tapped', async () => {
    const result = await handleJobRequestFlow(makePhotoCtx('photos_start'))
    expect(result.nextStep).toBe('collect_photos')
    expect(wa.sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Please upload *up to 5 photos* of the issue. You can send them together or one at a time.')
    )
  })

  it('uploads image and returns updated attachment IDs', async () => {
    ;(whatsappMedia.downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ attachmentId: 'att_001' })
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, baseData, 'image', 'media-abc'))
    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'media-abc', prefix: 'customer-photos', label: 'customer_photo' })
    )
    expect(result.nextStep).toBe('collect_photos')
    expect(result.nextData?.photoAttachmentIds).toEqual(['att_001'])
    expect(result.nextData?.photoMediaIds).toEqual(['media-abc'])
    expect(wa.sendButtons).toHaveBeenCalledWith(PHONE, expect.stringContaining('1 photo received'), expect.any(Array))
  })

  it('can suppress progress while an earlier image in a WhatsApp batch is processed', async () => {
    ;(whatsappMedia.downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ attachmentId: 'att_001' })
    const result = await handleJobRequestFlow({
      ...makePhotoCtx(undefined, undefined, baseData, 'image', 'media-abc'),
      suppressCustomerPhotoProgress: true,
      customerPhotoBatchSize: 3,
    })

    expect(result.nextData?.photoAttachmentIds).toEqual(['att_001'])
    expect(result.nextData?.photoMediaIds).toEqual(['media-abc'])
    expect(wa.sendButtons).not.toHaveBeenCalled()
  })

  it('accumulates multiple image uploads with correct total count', async () => {
    ;(whatsappMedia.downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ attachmentId: 'att_001' })
      .mockResolvedValueOnce({ attachmentId: 'att_002' })
      .mockResolvedValueOnce({ attachmentId: 'att_003' })

    const first = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, baseData, 'image', 'media-1'))
    const second = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, { ...baseData, ...first.nextData }, 'image', 'media-2'))
    const third = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, { ...baseData, ...first.nextData, ...second.nextData }, 'image', 'media-3'))

    expect(third.nextData?.photoAttachmentIds).toEqual(['att_001', 'att_002', 'att_003'])
    expect(third.nextData?.photoMediaIds).toEqual(['media-1', 'media-2', 'media-3'])
    const lastBody: string = (wa.sendButtons as any).mock.calls.at(-1)[1]
    expect(lastBody).toContain('3 photos received')
    expect(lastBody).toContain('add 2 more')
  })

  it('deduplicates repeated WhatsApp media IDs without creating another attachment', async () => {
    const data = { ...baseData, photoAttachmentIds: ['att_001'], photoMediaIds: ['media-1'] }
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, data, 'image', 'media-1'))

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(result.nextData?.photoAttachmentIds).toEqual(['att_001'])
    expect(result.nextData?.photoMediaIds).toEqual(['media-1'])
    expect(wa.sendButtons).toHaveBeenCalledWith(PHONE, expect.stringContaining('1 photo received'), expect.any(Array))
  })

  it('shows Done-only button when 5th photo is added (max reached)', async () => {
    ;(whatsappMedia.downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ attachmentId: 'att_005' })
    const data = { ...baseData, photoAttachmentIds: ['att_001', 'att_002', 'att_003', 'att_004'] }
    await handleJobRequestFlow(makePhotoCtx(undefined, undefined, data, 'image', 'media-xyz'))
    const buttons: { id: string }[] = (wa.sendButtons as any).mock.calls[0][2]
    expect(buttons).toHaveLength(1)
    expect(buttons[0].id).toBe('photos_done')
  })

  it('blocks upload and shows max-reached message when already at 5 photos', async () => {
    const data = { ...baseData, photoAttachmentIds: ['a', 'b', 'c', 'd', 'e'] }
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, data, 'image', 'media-extra'))
    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('collect_photos')
    expect(wa.sendButtons).toHaveBeenCalledWith(PHONE, expect.stringContaining('Maximum'), expect.any(Array))
  })

  it('rejects document with a helpful message', async () => {
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, baseData, 'document', 'doc-media'))
    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('collect_photos')
    expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('photo'))
    expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('not a document'))
  })

  it('continues to summary when photos_done is tapped with photos', async () => {
    const data = { ...baseData, photoAttachmentIds: ['att_001', 'att_002'] }
    const result = await handleJobRequestFlow(makePhotoCtx('photos_done', undefined, data))
    expect(result.nextStep).toBe('job_request_submitted')
    const body: string = (wa.sendButtons as any).mock.calls[0][1]
    expect(body).toContain('Photos: *2 attached*')
  })

  it('continues to summary when "done" is typed as free text', async () => {
    const data = { ...baseData, photoAttachmentIds: ['att_001'] }
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, 'done', data))
    expect(result.nextStep).toBe('job_request_submitted')
    expect(wa.sendButtons).toHaveBeenCalledWith(PHONE, expect.stringContaining('Photos: *1 attached*'), expect.any(Array))
  })

  it('shows upload-failed message and stays on collect_photos when download throws', async () => {
    ;(whatsappMedia.downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'))
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, undefined, baseData, 'image', 'media-bad'))
    expect(result.nextStep).toBe('collect_photos')
    expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining("couldn't upload"))
  })

  it('resends skip/start prompt on unknown reply when no photos yet', async () => {
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, 'something random'))
    expect(result.nextStep).toBe('collect_photos')
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Add a photo?'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'photos_skip' }),
        expect.objectContaining({ id: 'photos_start' }),
      ])
    )
  })

  it('resends done/add-more prompt on unknown reply when photos already added', async () => {
    const data = { ...baseData, photoAttachmentIds: ['att_001'] }
    const result = await handleJobRequestFlow(makePhotoCtx(undefined, 'something random', data))
    expect(result.nextStep).toBe('collect_photos')
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('1 photo added'),
      expect.arrayContaining([expect.objectContaining({ id: 'photos_done' })])
    )
  })
})
