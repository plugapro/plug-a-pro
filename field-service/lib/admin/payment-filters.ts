import type { PaymentStatus } from '@prisma/client'

export type PaymentDateRange = '7d' | '30d' | '90d' | 'ALL'
export type PaymentPspFilter = 'ALL' | string

export type PaymentFilterParams = {
  status?: string | string[]
  date?: string | string[]
  psp?: string | string[]
  message?: string | string[]
}

export type PaymentFilters = {
  status: PaymentStatus | 'ALL'
  dateRange: PaymentDateRange
  psp: PaymentPspFilter
}

const PAYMENT_STATUSES = new Set<PaymentStatus>([
  'PENDING',
  'AUTHORISED',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
])

const DATE_RANGES = new Set<PaymentDateRange>(['7d', '30d', '90d', 'ALL'])

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function parsePaymentFilters(params: PaymentFilterParams): PaymentFilters {
  const status = firstParam(params.status)
  const dateRange = firstParam(params.date)
  const psp = firstParam(params.psp)

  return {
    status: status && PAYMENT_STATUSES.has(status as PaymentStatus) ? (status as PaymentStatus) : 'PENDING',
    dateRange: dateRange && DATE_RANGES.has(dateRange as PaymentDateRange) ? (dateRange as PaymentDateRange) : '30d',
    psp: psp && psp !== 'ALL' ? psp : 'ALL',
  }
}

export function buildPaymentFilterHref(
  current: PaymentFilterParams,
  updates: Partial<PaymentFilters>,
) {
  const next = {
    ...parsePaymentFilters(current),
    ...updates,
  }
  const params = new URLSearchParams()

  // Filter URLs are shareable operational state; transient banner messages are intentionally dropped.
  params.set('status', next.status)
  params.set('date', next.dateRange)
  params.set('psp', next.psp)

  return `/admin/payments?${params.toString()}`
}

export function dateRangeToCreatedAt(dateRange: PaymentDateRange, now = new Date()) {
  if (dateRange === 'ALL') return undefined
  const days = Number.parseInt(dateRange, 10)
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
