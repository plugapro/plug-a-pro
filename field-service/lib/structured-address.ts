import { buildLegacyStreetAddress, normalizeAddressField } from './address-format'
import { getStructuredAddressSelection } from './location-nodes'

export type StructuredAddressCaptureInput = {
  addressLine1: string
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
  locationNodeId: string
}

export type ResolvedStructuredAddressCapture = {
  street: string
  addressLine1: string
  addressLine2: string | null
  complexName: string | null
  unitNumber: string | null
  suburb: string
  region: string
  city: string
  province: string
  postalCode: string
  locationNodeId: string
}

export class InvalidStructuredAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStructuredAddressError'
  }
}

export async function resolveStructuredAddressCapture(
  input: StructuredAddressCaptureInput,
): Promise<ResolvedStructuredAddressCapture> {
  const addressLine1 = normalizeAddressField(input.addressLine1)
  const addressLine2 = normalizeAddressField(input.addressLine2)
  const complexName = normalizeAddressField(input.complexName)
  const unitNumber = normalizeAddressField(input.unitNumber)

  if (!addressLine1) {
    throw new InvalidStructuredAddressError('Street address line 1 is required.')
  }

  if (!input.locationNodeId?.trim()) {
    throw new InvalidStructuredAddressError('A valid suburb selection is required.')
  }

  const selection = await getStructuredAddressSelection(input.locationNodeId.trim())
  if (!selection) {
    throw new InvalidStructuredAddressError('Selected suburb is not valid for structured address capture.')
  }

  return {
    street: buildLegacyStreetAddress({ addressLine1, addressLine2, complexName, unitNumber }),
    addressLine1,
    addressLine2: addressLine2 || null,
    complexName: complexName || null,
    unitNumber: unitNumber || null,
    suburb: selection.suburb,
    region: selection.region,
    city: selection.city,
    province: selection.province,
    postalCode: selection.postalCode,
    locationNodeId: selection.locationNodeId,
  }
}
