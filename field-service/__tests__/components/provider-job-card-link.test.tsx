import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { JobCard } from '@/components/shared/JobCard'

function makeJob(id: string) {
  return {
    id,
    status: 'SCHEDULED',
    booking: {
      id: 'booking_1',
      scheduledDate: new Date('2026-05-23T00:00:00.000Z'),
      scheduledWindow: '00:00–04:00',
      match: {
        id: 'match_1',
        jobRequest: {
          id: 'request_1',
          category: 'DIY & Assembly',
          customer: { id: 'customer_1', name: 'Sarah Sullivan', phone: '+27773923802' },
          address: { id: 'address_1', suburb: 'Constantia Kloof', city: 'Johannesburg' },
        },
      },
    },
  } as any
}

describe('provider job card route', () => {
  it('links scheduled job cards to provider job detail using job id (not booking id)', () => {
    const html = renderToStaticMarkup(<JobCard job={makeJob('job_123')} basePath="/provider" />)
    expect(html).toContain('href="/provider/jobs/job_123"')
    expect(html).not.toContain('href="/provider/jobs/booking_1"')
  })
})
