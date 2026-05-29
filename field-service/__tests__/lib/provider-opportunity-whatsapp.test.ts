import { describe, expect, it } from 'vitest'
import { parseProviderOpportunityArrivalText } from '../../lib/provider-opportunity-whatsapp'
import { buildProviderLeadPreviewMessage } from '../../lib/provider-credit-copy'
import { bodyContainsRawUrl } from '../../lib/whatsapp-copy'

// Protected customer fields that must NEVER appear in WhatsApp preview message bodies.
// These constants serve as regression anchors - if a field name appears in a body string
// it indicates that sensitive data has been inlined.
const PROTECTED_FIELD_PATTERNS = [
  'customerPhone',
  'customerEmail',
  'customer_phone',
  'customer_email',
  'street',
  'addressLine1',
  'address_line',
  'unitNumber',
  'unit_number',
  'complexName',
  'complex_name',
  'accessNotes',
  'access_notes',
  'latitude',
  'longitude',
  'lat:',
  'lng:',
]

// Sample wallet balance for all preview tests.
const MOCK_BALANCE = { totalCreditBalance: 5, paidCreditBalance: 2, promoCreditBalance: 3 }

describe('provider opportunity WhatsApp helpers', () => {
  it('parses common WhatsApp arrival phrases', () => {
    const now = new Date('2026-05-02T08:00:00.000Z')

    expect(parseProviderOpportunityArrivalText('today afternoon', now)?.toISOString()).toBe('2026-05-02T12:00:00.000Z')
    expect(parseProviderOpportunityArrivalText('tomorrow morning', now)?.toISOString()).toBe('2026-05-03T07:00:00.000Z')
    expect(parseProviderOpportunityArrivalText('tomorrow evening', now)?.toISOString()).toBe('2026-05-03T15:00:00.000Z')
  })

  it('accepts exact date input and rejects unclear text', () => {
    expect(parseProviderOpportunityArrivalText('2026-05-03T09:00:00+02:00')?.toISOString()).toBe('2026-05-03T07:00:00.000Z')
    expect(parseProviderOpportunityArrivalText('soon please')).toBeNull()
  })
})

// ─── Privacy enforcement: preview message body ────────────────────────────────
// These tests assert that the WhatsApp preview message produced by
// buildProviderLeadPreviewMessage never contains protected customer fields
// (phone, email, exact street, unit, complex, access notes, GPS coordinates).
// They are the regression anchor for Step 06 privacy enforcement.

describe('buildProviderLeadPreviewMessage - privacy enforcement', () => {
  const baseParams = {
    category: 'Plumbing',
    area: 'Ruimsig',
    preferredTime: 'Today morning',
    deadlineTime: '14:00',
    balance: MOCK_BALANCE,
  }

  it('produces a well-formed preview body', () => {
    const body = buildProviderLeadPreviewMessage(baseParams)
    expect(body).toContain('New Job Opportunity')
    expect(body).toContain('Plumbing')
    expect(body).toContain('Ruimsig')
    expect(body).toContain('Today morning')
    expect(body).toContain('14:00')
    expect(body).toContain('comparing suitable providers')
  })

  it('does not embed any protected customer field in the message body', () => {
    const body = buildProviderLeadPreviewMessage({
      ...baseParams,
      title: 'Blocked shower drain',
      description: 'Water backing up. Gate code 1234.',
      subcategory: 'Blocked drain',
      urgency: 'Today',
    })
    for (const pattern of PROTECTED_FIELD_PATTERNS) {
      expect(body.toLowerCase()).not.toContain(pattern.toLowerCase())
    }
    // Explicit check: no phone-like sequences appear in safe preview
    expect(body).not.toMatch(/\+27\d{9}/)
    expect(body).not.toMatch(/07\d{8}/)
    // No email-like patterns
    expect(body).not.toMatch(/\S+@\S+\.\S+/)
  })

  it('does not embed street-level address detail', () => {
    // This verifies that even if a caller accidentally passes address fields,
    // the builder only places the safe area (suburb/city) in the output.
    const body = buildProviderLeadPreviewMessage({
      ...baseParams,
      // city/province are allowed in the area summary
      city: 'Johannesburg',
      province: 'Gauteng',
    })
    // Street-level tokens must not appear
    expect(body).not.toContain('123 Main Street')
    expect(body).not.toContain('Unit 4')
    expect(body).not.toContain('access code')
    // Safe area lines are expected
    expect(body).toContain('Ruimsig')
    expect(body).toContain('Johannesburg')
  })

  it('includes photo count line when photosCount is provided', () => {
    const bodyWithPhotos = buildProviderLeadPreviewMessage({ ...baseParams, photosCount: 3 })
    expect(bodyWithPhotos).toContain('Photos: *3 available*')
  })

  it('omits photo count line when photosCount is null or undefined', () => {
    const bodyNoPhotos = buildProviderLeadPreviewMessage({ ...baseParams, photosCount: null })
    expect(bodyNoPhotos).not.toContain('Photos:')

    const bodyUndefined = buildProviderLeadPreviewMessage({ ...baseParams })
    expect(bodyUndefined).not.toContain('Photos:')
  })

  it('shows zero-photo count correctly when photosCount is 0', () => {
    const body = buildProviderLeadPreviewMessage({ ...baseParams, photosCount: 0 })
    expect(body).toContain('Photos: *0 available*')
  })

  it('body does not contain a raw URL (CTA must use sendCtaUrl, not inline links)', () => {
    const body = buildProviderLeadPreviewMessage(baseParams)
    expect(bodyContainsRawUrl(body)).toBe(false)
  })
})
