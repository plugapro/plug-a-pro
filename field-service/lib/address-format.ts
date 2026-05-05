export type StreetAddressFields = {
  addressLine1?: string | null
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
}

export function normalizeAddressField(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

export function buildLegacyStreetAddress(fields: StreetAddressFields, fallbackStreet?: string | null) {
  const unitNumber = normalizeAddressField(fields.unitNumber)
  const complexName = normalizeAddressField(fields.complexName)
  const addressLine1 = normalizeAddressField(fields.addressLine1)
  const addressLine2 = normalizeAddressField(fields.addressLine2)

  const prefix = [unitNumber && `Unit ${unitNumber}`, complexName].filter(Boolean).join(', ')
  const suffix = [addressLine1, addressLine2].filter(Boolean).join(', ')
  const composed = [prefix, suffix].filter(Boolean).join(', ')

  return composed || normalizeAddressField(fallbackStreet)
}
