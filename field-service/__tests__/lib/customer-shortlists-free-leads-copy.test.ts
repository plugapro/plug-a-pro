import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/db', () => ({ db: {} }))

import { buildProviderSelectedNotificationBody } from '../../lib/customer-shortlists'

const base = {
  category: 'plumbing',
  suburb: 'Sandton',
  urgency: null,
  title: 'Leaking tap',
  description: 'Kitchen tap leaking',
  requestedWindowStart: null,
  requestedWindowEnd: null,
  attachmentCount: 1,
  balanceLabel: '2 credits',
  remainingCreditLabel: '1 credit',
}

describe('selected-provider notification copy - free leads mode', () => {
  it('ON: replaces the credit cost and balance lines with the free line', () => {
    const body = buildProviderSelectedNotificationBody({ ...base, free: true })

    expect(body).toContain('Free during launch — no credits needed.')
    expect(body).not.toContain('Accepting this job uses 1 credit')
    expect(body).not.toContain('Available balance')
    expect(body).not.toContain('After acceptance')
    expect(body).toContain('Reply:\n*1* Accept\n*2* Decline')
  })

  it('OFF: keeps the credit cost and balance lines', () => {
    const body = buildProviderSelectedNotificationBody(base)

    expect(body).toContain('Accepting this job uses 1 credit.\n\nAvailable balance: 2 credits\nAfter acceptance: 1 credit\n\n')
    expect(body).not.toContain('Free during launch')
  })
})
