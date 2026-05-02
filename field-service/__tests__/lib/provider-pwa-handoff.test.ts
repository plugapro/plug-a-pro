import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PWA_HANDOFF_MAP,
  resolveProviderPwaHandoffPath,
} from '@/lib/provider-pwa-handoff'

describe('provider PWA handoff resolver', () => {
  it('maps WhatsApp events to existing provider PWA routes', () => {
    expect(PROVIDER_PWA_HANDOFF_MAP.application_approved).toBe('/provider')
    expect(PROVIDER_PWA_HANDOFF_MAP.credits_low).toBe('/provider/credits')
    expect(PROVIDER_PWA_HANDOFF_MAP.new_opportunity).toBe('/provider/leads')
    expect(PROVIDER_PWA_HANDOFF_MAP.job_accepted).toBe('/provider/jobs')
  })

  it('routes an old opportunity token to the canonical signed lead screen', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'new_opportunity',
      token: 'signed.token',
      lead: {
        id: 'lead-1',
        status: 'VIEWED',
        jobRequestId: 'request-1',
        jobRequest: { match: null },
      },
    })).toBe('/leads/access/signed.token')
  })

  it('routes an old opportunity token to accepted job state after acceptance', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'new_opportunity',
      token: 'signed.token',
      lead: {
        id: 'lead-1',
        status: 'ACCEPTED',
        jobRequestId: 'request-1',
        jobRequest: {
          match: {
            id: 'match-1',
            status: 'QUOTE_APPROVED',
          },
        },
      },
    })).toBe('/leads/access/signed.token')
  })

  it('uses provider credits route for low-credit handoff without creating a duplicate wallet screen', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'credits_low',
    })).toBe('/provider/credits')
  })
})
