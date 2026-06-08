// Tests for lib/customer-name.ts — placeholder detection + display-name
// selection used by the customer PWA home page greeting. The "Hi WhatsApp"
// regression came from the home page splitting Customer.name on whitespace
// without first checking whether the value was a placeholder like
// "WhatsApp Customer" written by lib/whatsapp-flows/job-request.ts.

import { describe, it, expect } from 'vitest'
import {
  isCustomerNamePlaceholder,
  normalizeCustomerName,
  pickCustomerDisplayFirstName,
} from '@/lib/customer-name'

describe('normalizeCustomerName', () => {
  it('returns null for empty / very short values', () => {
    expect(normalizeCustomerName(undefined)).toBeNull()
    expect(normalizeCustomerName(null)).toBeNull()
    expect(normalizeCustomerName('')).toBeNull()
    expect(normalizeCustomerName('  ')).toBeNull()
    expect(normalizeCustomerName('a')).toBeNull()
  })

  it('treats known placeholder strings as null', () => {
    expect(normalizeCustomerName('WhatsApp Customer')).toBeNull()
    expect(normalizeCustomerName('whatsapp customer')).toBeNull()
    expect(normalizeCustomerName('Customer')).toBeNull()
    expect(normalizeCustomerName('there')).toBeNull()
  })

  it('returns trimmed value for real names', () => {
    expect(normalizeCustomerName('  Sarah  ')).toBe('Sarah')
    expect(normalizeCustomerName('Sarah Mokoena')).toBe('Sarah Mokoena')
  })
})

describe('isCustomerNamePlaceholder', () => {
  it('flags whole-string placeholders', () => {
    expect(isCustomerNamePlaceholder('WhatsApp Customer')).toBe(true)
    expect(isCustomerNamePlaceholder('Customer')).toBe(true)
    expect(isCustomerNamePlaceholder('there')).toBe(true)
  })

  it('flags first-token placeholders (the actual bug case)', () => {
    // First-token guard is the reason we no longer show "Hi WhatsApp".
    expect(isCustomerNamePlaceholder('WhatsApp Sarah')).toBe(true)
    expect(isCustomerNamePlaceholder('Customer Foo')).toBe(true)
  })

  it('returns true for empty / whitespace input', () => {
    expect(isCustomerNamePlaceholder(undefined)).toBe(true)
    expect(isCustomerNamePlaceholder(null)).toBe(true)
    expect(isCustomerNamePlaceholder('')).toBe(true)
    expect(isCustomerNamePlaceholder('   ')).toBe(true)
  })

  it('returns false for real names', () => {
    expect(isCustomerNamePlaceholder('Sarah')).toBe(false)
    expect(isCustomerNamePlaceholder('Lebogang Mokoena')).toBe(false)
  })
})

describe('pickCustomerDisplayFirstName', () => {
  it('returns the first token of Customer.name when it is real', () => {
    expect(pickCustomerDisplayFirstName({ customerName: 'Sarah Mokoena' })).toBe('Sarah')
  })

  it('falls back to auth metadata when Customer.name is a placeholder', () => {
    expect(
      pickCustomerDisplayFirstName({
        customerName: 'WhatsApp Customer',
        authDisplayName: 'Sarah from WhatsApp',
      }),
    ).toBe('Sarah')
  })

  it('returns null when nothing usable is available (caller renders "there")', () => {
    expect(pickCustomerDisplayFirstName({})).toBeNull()
    expect(pickCustomerDisplayFirstName({ customerName: 'WhatsApp Customer' })).toBeNull()
    expect(
      pickCustomerDisplayFirstName({ customerName: null, authDisplayName: 'Customer' }),
    ).toBeNull()
  })

  it('never returns a placeholder token even if it sneaks into the source', () => {
    // Defence in depth: write-side normalisation could regress and produce
    // "Customer Sarah" as a stored value. The picker still refuses to surface
    // "Customer" as the displayed first name.
    expect(
      pickCustomerDisplayFirstName({ customerName: 'Customer Sarah' }),
    ).toBeNull()
  })
})
