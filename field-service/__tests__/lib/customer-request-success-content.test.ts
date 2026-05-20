import { describe, expect, it } from 'vitest'
import { getRequestSuccessContent } from '../../lib/customer-request-success-content'

describe('getRequestSuccessContent', () => {
  it('returns review-first copy and tracking CTA when review mode is selected', () => {
    const result = getRequestSuccessContent({
      jobRequestId: 'req-1',
      ticketUrl: '/requests/access/token',
      selectedMatchingMode: 'review_first',
      preferredProviderId: null,
      hasProviderResponses: false,
    })

    expect(result.mode).toBe('review_first')
    expect(result.title).toBe('Request sent - waiting for provider responses')
    expect(result.whatsappNote).toContain('first provider responds')
    expect(result.primaryCtaLabel).toBe('Track provider responses')
    expect(result.primaryCtaHref).toContain('view=providers_reviewing')
    expect(result.secondaryCtaLabel).toBe('View my requests')
  })

  it('switches to review responses CTA when provider responses already exist', () => {
    const result = getRequestSuccessContent({
      jobRequestId: 'req-2',
      ticketUrl: 'https://app.plugapro.co.za/requests/access/token?view=request_submitted',
      selectedMatchingMode: 'review_first',
      hasProviderResponses: true,
      preferredProviderId: null,
    })

    expect(result.title).toBe('Provider responses are ready to review')
    expect(result.primaryCtaLabel).toBe('Review provider responses')
    expect(result.primaryCtaHref).toContain('view=providers_reviewing')
  })

  it('returns quick match-specific copy and CTA', () => {
    const result = getRequestSuccessContent({
      jobRequestId: 'req-3',
      ticketUrl: '/requests/access/token',
      selectedMatchingMode: 'quick_match',
      preferredProviderId: null,
    })

    expect(result.mode).toBe('quick_match')
    expect(result.title).toBe('Request sent - finding your provider')
    expect(result.description).toContain('fastest suitable provider')
    expect(result.primaryCtaLabel).toBe('Track request')
    expect(result.primaryCtaHref).toContain('view=matching_progress')
  })

  it('returns preferred provider content when preferredProviderId exists', () => {
    const result = getRequestSuccessContent({
      jobRequestId: 'req-4',
      ticketUrl: '/requests/access/token',
      selectedMatchingMode: null,
      preferredProviderId: 'prov-1',
    })

    expect(result.mode).toBe('preferred_provider')
    expect(result.title).toBe('Request sent to your selected provider')
    expect(result.primaryCtaLabel).toBe('Track provider response')
    expect(result.primaryCtaHref).toContain('view=provider_confirmation')
  })

  it('falls back safely when mode is missing', () => {
    const result = getRequestSuccessContent({
      jobRequestId: 'req-5',
      ticketUrl: null,
      selectedMatchingMode: null,
      preferredProviderId: null,
    })

    expect(result.mode).toBe('unknown')
    expect(result.title).toBe('Request sent')
    expect(result.primaryCtaLabel).toBe('Track request')
    expect(result.primaryCtaHref).toBe('/requests/req-5')
  })
})
