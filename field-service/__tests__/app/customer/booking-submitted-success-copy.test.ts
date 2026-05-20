import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('BookingFlow submitted screen copy and CTA behavior', () => {
  it('uses mode-aware request success content and CTA labels', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/customer/BookingFlow.tsx'),
      'utf8',
    )

    expect(source).toContain("import { getRequestSuccessContent } from '@/lib/customer-request-success-content'")
    expect(source).toContain('modeAwareContent?.title')
    expect(source).toContain('modeAwareContent?.description')
    expect(source).toContain('modeAwareContent?.primaryCtaLabel')
    expect(source).toContain('What happens next?')
    expect(source).toContain('Track request')
    expect(source).toContain('View my requests')
  })

  it('emits structured success-view observability event', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/customer/BookingFlow.tsx'),
      'utf8',
    )

    expect(source).toContain('request_submitted_success_viewed')
    expect(source).toContain("source: 'pwa'")
    expect(source).toContain("authState: 'authenticated'")
    expect(source).toContain('matchMode: successView.mode')
  })
})
