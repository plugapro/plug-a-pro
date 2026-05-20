import { describe, expect, test } from 'vitest'
import {
  buildPaymentFilterHref,
  parsePaymentFilters,
} from '@/lib/admin/payment-filters'
import {
  DISPUTE_RESOLUTION_OPTIONS,
  getDisputeResolutionLabel,
} from '@/lib/admin/dispute-resolution'

describe('admin console payment filters', () => {
  test('defaults payments to pending rows from the last 30 days', () => {
    const filters = parsePaymentFilters({})

    expect(filters).toEqual({
      status: 'PENDING',
      dateRange: '30d',
      psp: 'ALL',
    })
  })

  test('builds shareable filter URLs without carrying message banners', () => {
    const href = buildPaymentFilterHref(
      { status: 'PAID', date: '7d', psp: 'payfast', message: 'refund_issued' },
      { status: 'FAILED' },
    )

    expect(href).toBe('/admin/payments?status=FAILED&date=7d&psp=payfast')
  })
})

describe('admin console dispute resolution choices', () => {
  test('exposes the three structured resolution outcomes required by Trust', () => {
    expect(DISPUTE_RESOLUTION_OPTIONS.map((option) => option.status)).toEqual([
      'RESOLVED_CUSTOMER',
      'RESOLVED_PROVIDER',
      'RESOLVED_SPLIT',
    ])
  })

  test('formats resolved status badges with the selected outcome', () => {
    expect(getDisputeResolutionLabel('RESOLVED_CUSTOMER')).toBe('resolved · customer')
    expect(getDisputeResolutionLabel('RESOLVED_PROVIDER')).toBe('resolved · provider')
    expect(getDisputeResolutionLabel('RESOLVED_SPLIT')).toBe('resolved · split')
  })
})
