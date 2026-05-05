import { describe, expect, it } from 'vitest'
import { buildClientPwaJobTrackingSteps } from '../../lib/client-pwa-job-tracking'

function currentLabel(params: Parameters<typeof buildClientPwaJobTrackingSteps>[0]) {
  return buildClientPwaJobTrackingSteps(params).find((step) => step.current)?.label
}

describe('client PWA job tracking timeline', () => {
  it('keeps a newly accepted scheduled job on provider accepted until WhatsApp arrival is confirmed', () => {
    expect(currentLabel({ status: 'SCHEDULED', arrivalTimeConfirmedAt: null })).toBe('Provider accepted')
  })

  it('uses the WhatsApp-confirmed arrival timestamp to advance the customer timeline', () => {
    expect(currentLabel({ status: 'SCHEDULED', arrivalTimeConfirmedAt: new Date('2026-05-02T12:00:00.000Z') })).toBe(
      'Arrival time confirmed',
    )
  })

  it('maps provider WhatsApp status commands into the customer tracking states', () => {
    expect(currentLabel({ status: 'EN_ROUTE' })).toBe('Provider on the way')
    expect(currentLabel({ status: 'ARRIVED' })).toBe('Provider arrived')
    expect(currentLabel({ status: 'STARTED' })).toBe('Job in progress')
    expect(currentLabel({ status: 'PENDING_COMPLETION_CONFIRMATION' })).toBe('Job completed')
  })
})
