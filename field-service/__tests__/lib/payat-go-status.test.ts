import { describe, expect, it } from 'vitest'
import { mapPayAtGoAccountStateToInternalStatus } from '@/lib/payat-go/status'

describe('mapPayAtGoAccountStateToInternalStatus', () => {
  it('maps outstanding-like statuses to SENT/PENDING', () => {
    expect(mapPayAtGoAccountStateToInternalStatus('PAYMENT_OUTSTANDING')).toBe('SENT')
    expect(mapPayAtGoAccountStateToInternalStatus('PROCESSING_PAYMENT')).toBe('PENDING')
    expect(mapPayAtGoAccountStateToInternalStatus('PAYMENT_READY_FOR_SETTLEMENT')).toBe('PENDING')
  })

  it('maps completed-like statuses to PAID', () => {
    expect(mapPayAtGoAccountStateToInternalStatus('PAYMENT_COMPLETED')).toBe('PAID')
    expect(mapPayAtGoAccountStateToInternalStatus('SETTLEMENT_PROCESSED')).toBe('PAID')
  })

  it('maps failed/cancelled/expired statuses', () => {
    expect(mapPayAtGoAccountStateToInternalStatus('PARTIAL_PAYMENT_RECEIVED')).toBe('FAILED')
    expect(mapPayAtGoAccountStateToInternalStatus('PAYMENT_FEES_ISSUE')).toBe('FAILED')
    expect(mapPayAtGoAccountStateToInternalStatus('PAYMENT_CANCELLED')).toBe('CANCELLED')
    expect(mapPayAtGoAccountStateToInternalStatus('CANCELLED_DUE_TO_PRICING_PACKAGE_UPDATE')).toBe('CANCELLED')
    expect(mapPayAtGoAccountStateToInternalStatus('PAYMENT_EXPIRED')).toBe('EXPIRED')
  })

  it('maps unknown statuses to UNKNOWN', () => {
    expect(mapPayAtGoAccountStateToInternalStatus('UNSEEN_STATUS')).toBe('UNKNOWN')
    expect(mapPayAtGoAccountStateToInternalStatus(undefined)).toBe('UNKNOWN')
  })
})
