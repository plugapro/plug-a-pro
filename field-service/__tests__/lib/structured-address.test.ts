import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  InvalidStructuredAddressError,
  resolveStructuredAddressCapture,
} from '../../lib/structured-address'

const { mockGetStructuredAddressSelection } = vi.hoisted(() => ({
  mockGetStructuredAddressSelection: vi.fn(),
}))

vi.mock('../../lib/location-nodes', () => ({
  getStructuredAddressSelection: mockGetStructuredAddressSelection,
}))

describe('resolveStructuredAddressCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a normalized structured address with legacy street summary', async () => {
    mockGetStructuredAddressSelection.mockResolvedValue({
      locationNodeId: 'suburb-1',
      suburb: 'Sandton',
      region: 'JHB North / Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
    })

    const result = await resolveStructuredAddressCapture({
      addressLine1: ' 12 Main Road ',
      addressLine2: ' Block B ',
      complexName: ' Acacia Mews ',
      unitNumber: ' 7 ',
      locationNodeId: 'suburb-1',
    })

    expect(result).toEqual({
      street: 'Unit 7, Acacia Mews, 12 Main Road, Block B',
      addressLine1: '12 Main Road',
      addressLine2: 'Block B',
      complexName: 'Acacia Mews',
      unitNumber: '7',
      suburb: 'Sandton',
      region: 'JHB North / Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      locationNodeId: 'suburb-1',
    })
  })

  it('rejects captures without a valid structured suburb selection', async () => {
    mockGetStructuredAddressSelection.mockResolvedValue(null)

    await expect(
      resolveStructuredAddressCapture({
        addressLine1: '12 Main Road',
        locationNodeId: 'missing-node',
      }),
    ).rejects.toThrow(InvalidStructuredAddressError)
  })
})
