import { describe, expect, it } from 'vitest'
import { resolvePreferredTimingWindow, validateClientRequestDetails } from '../../lib/client-request-flow'

describe('client request flow helpers', () => {
  it('requires privacy and terms acknowledgement before submission', () => {
    expect(
      validateClientRequestDetails({
        title: 'Fix leaking tap',
        description: 'Kitchen tap keeps dripping',
        privacyAcknowledged: false,
        termsAcknowledged: true,
      }),
    ).toBe('Please confirm you understand when your contact and exact address are shared.')

    expect(
      validateClientRequestDetails({
        title: 'Fix leaking tap',
        description: 'Kitchen tap keeps dripping',
        privacyAcknowledged: true,
        termsAcknowledged: true,
      }),
    ).toBeNull()
  })

  it('converts preferred date and time window into request timing fields', () => {
    const timing = resolvePreferredTimingWindow({
      urgency: 'flexible',
      preferredDate: '2026-05-10',
      preferredTimeWindow: 'afternoon',
    })

    expect(timing.requestedWindowStart?.getHours()).toBe(12)
    expect(timing.requestedWindowEnd?.getHours()).toBe(17)
    expect(timing.requestedArrivalLatest).toEqual(timing.requestedWindowEnd)
  })
})
