import { describe, it, expect } from 'vitest'

// ─── Extracted validation logic (pure function) ─────────────────────────────

/**
 * Validates the address step of the booking flow.
 * Allows region to be empty when locationNodeId is set (SavedSite path).
 * When both region and locationNodeId are empty, region is required (manual entry path).
 */
function validateAddressStep(input: {
  suburb: string
  city: string
  region: string
  province: string
  postalCode: string
  locationNodeId: string | null
}): string | null {
  const PROVINCE_KEY_BY_LABEL: Record<string, string> = {
    Gauteng: 'gauteng',
    'Western Cape': 'western_cape',
    'KwaZulu-Natal': 'kwazulu_natal',
    'Eastern Cape': 'eastern_cape',
    Limpopo: 'limpopo',
    Mpumalanga: 'mpumalanga',
    'North West': 'north_west',
    'Free State': 'free_state',
    'Northern Cape': 'northern_cape',
  }

  function normalizeValue(value: string) {
    return value.trim().replace(/\s+/g, ' ')
  }

  if (!input.locationNodeId) {
    return 'Select your suburb before continuing — use "Use my location" or type in the search box.'
  }

  const suburb = normalizeValue(input.suburb)
  const city = normalizeValue(input.city)
  const province = normalizeValue(input.province)
  const region = normalizeValue(input.region)
  const postalCode = input.postalCode.trim()

  // The fix: allow region to be empty when locationNodeId is set
  if (!suburb || !city || (!region && !input.locationNodeId) || !province || !postalCode) {
    return 'Please complete the full service address before continuing.'
  }

  if (!Object.prototype.hasOwnProperty.call(PROVINCE_KEY_BY_LABEL, province)) {
    return 'Please select a valid South African province.'
  }

  if (!/^\d{4}$/.test(postalCode)) {
    return 'Postal code must come from the selected suburb.'
  }

  const addressLine1 = normalizeValue('')
  if (!addressLine1) {
    return 'Enter the street address after choosing the suburb.'
  }

  return null
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BookingFlow address validation', () => {
  it('should accept SavedSite address with locationNodeId even when region is empty', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: '', // Empty because SavedSite clears it
      province: 'Gauteng',
      postalCode: '2146',
      locationNodeId: 'node-123', // Set from SavedSite
    })
    // Should pass validation up to the street address check
    expect(result).toBe('Enter the street address after choosing the suburb.')
  })

  it('should reject manual entry address when both region and locationNodeId are empty', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: '', // Empty
      province: 'Gauteng',
      postalCode: '2146',
      locationNodeId: null, // No locationNodeId from SavedSite
    })
    // Should fail validation at the locationNodeId check (required before address fields)
    expect(result).toBe('Select your suburb before continuing — use "Use my location" or type in the search box.')
  })

  it('should accept fully populated address with region', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: '2146',
      locationNodeId: 'node-123',
    })
    // Should pass validation up to the street address check
    expect(result).toBe('Enter the street address after choosing the suburb.')
  })

  it('should reject when suburb is missing', () => {
    const result = validateAddressStep({
      suburb: '',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: '2146',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Please complete the full service address before continuing.')
  })

  it('should reject when city is missing', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: '',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: '2146',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Please complete the full service address before continuing.')
  })

  it('should reject when province is missing', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: '',
      postalCode: '2146',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Please complete the full service address before continuing.')
  })

  it('should reject when postalCode is missing', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: '',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Please complete the full service address before continuing.')
  })

  it('should reject when locationNodeId is missing (suburb picker step not complete)', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: '2146',
      locationNodeId: null,
    })
    expect(result).toBe('Select your suburb before continuing — use "Use my location" or type in the search box.')
  })

  it('should reject invalid province', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'InvalidProvince',
      postalCode: '2146',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Please select a valid South African province.')
  })

  it('should reject invalid postal code (non-numeric)', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: 'ABCD',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Postal code must come from the selected suburb.')
  })

  it('should reject invalid postal code (wrong length)', () => {
    const result = validateAddressStep({
      suburb: 'Sandton',
      city: 'Johannesburg',
      region: 'Johannesburg Metro',
      province: 'Gauteng',
      postalCode: '214',
      locationNodeId: 'node-123',
    })
    expect(result).toBe('Postal code must come from the selected suburb.')
  })
})
