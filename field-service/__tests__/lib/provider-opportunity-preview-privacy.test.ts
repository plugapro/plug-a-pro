// Regression guard: getSafeProviderOpportunityPreview must never expose
// customer phone, street or access notes before the lead is accepted.
// See lib/provider-opportunity-responses.ts comment at line ~90.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLead } = vi.hoisted(() => ({
  mockLead: { findUnique: vi.fn() },
}))

vi.mock('@/lib/db', () => ({
  db: {
    lead: mockLead,
  },
}))

import {
  getSafeProviderOpportunityPreview,
  ProviderOpportunityResponseError,
} from '@/lib/provider-opportunity-responses'

const SAFE_LEAD = {
  id: 'lead-1',
  providerId: 'prov-1',
  status: 'SENT',
  expiresAt: new Date(Date.now() + 3600_000),
  jobRequest: {
    id: 'jr-1',
    category: 'plumbing',
    subcategory: null,
    title: 'Burst pipe',
    description: 'Water under the kitchen sink keeps dripping.',
    urgency: 'NORMAL',
    providerPreference: null,
    budgetPreference: null,
    requestedWindowStart: null,
    requestedWindowEnd: null,
    requestedArrivalLatest: null,
    address: {
      suburb: 'Gardens',
      region: null,
      city: 'Cape Town',
      province: 'Western Cape',
      // These fields are NOT in the Prisma select - but if they somehow leaked through,
      // the assertions below would catch it.
    },
    attachments: [
      { id: 'att-1', caption: 'Tap photo', label: 'customer_photo' },
    ],
  },
}

describe('getSafeProviderOpportunityPreview - privacy enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits customer phone, street, addressLine1, unitNumber and accessNotes before acceptance', async () => {
    mockLead.findUnique.mockResolvedValue(SAFE_LEAD)

    const preview = await getSafeProviderOpportunityPreview('lead-1', 'prov-1')

    expect(preview).not.toBeNull()
    const serialized = JSON.stringify(preview)

    // Phone must never appear
    expect(serialized).not.toContain('+27821112222')
    expect(serialized).not.toMatch(/"phone"\s*:/)

    // Street and address details must never appear
    expect(serialized).not.toContain('12 Long Street')
    expect(serialized).not.toMatch(/"street"\s*:/)
    expect(serialized).not.toMatch(/"addressLine1"\s*:/)
    expect(serialized).not.toMatch(/"unitNumber"\s*:/)
    expect(serialized).not.toMatch(/"accessNotes"\s*:/)

    // Customer identity fields must not appear
    expect(serialized).not.toMatch(/"customer"\s*:/)
    expect(serialized).not.toMatch(/"email"\s*:/)

    // Safe area fields MUST be present
    expect(serialized).toContain('Gardens')
    expect(serialized).toContain('Cape Town')
  })

  it('returns null when lead does not exist', async () => {
    mockLead.findUnique.mockResolvedValue(null)

    const preview = await getSafeProviderOpportunityPreview('ghost-lead', 'prov-1')

    expect(preview).toBeNull()
  })

  it('throws FORBIDDEN if a different provider tries to preview the lead', async () => {
    mockLead.findUnique.mockResolvedValue(SAFE_LEAD)

    await expect(getSafeProviderOpportunityPreview('lead-1', 'prov-other')).rejects.toThrow(
      ProviderOpportunityResponseError,
    )
  })
})
