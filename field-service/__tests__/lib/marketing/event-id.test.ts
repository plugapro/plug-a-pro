import { describe, expect, it } from 'vitest'

import { eventId } from '@/lib/marketing/event-id'

describe('eventId', () => {
  it('joins event name and entity id with a colon', () => {
    expect(eventId('payment_success', 'bk_42')).toBe('payment_success:bk_42')
  })

  it('trims whitespace from the entity id (PSP refs sometimes have it)', () => {
    expect(eventId('payment_failed', '  bk_x  ')).toBe('payment_failed:bk_x')
  })

  it('is deterministic — same inputs produce the same id every time', () => {
    expect(eventId('quote_approved', 'q1')).toBe(eventId('quote_approved', 'q1'))
  })
})
