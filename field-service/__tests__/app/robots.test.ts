import { describe, expect, it } from 'vitest'

import robots from '@/app/robots'

describe('field-service robots', () => {
  const config = robots()

  it('disallows the entire app surface (the PWA is not an SEO surface)', () => {
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules]
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ userAgent: '*', disallow: '/' })
  })

  it('does not advertise a sitemap (none should be indexable)', () => {
    expect(config.sitemap).toBeUndefined()
  })
})
