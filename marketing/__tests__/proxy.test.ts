import { afterEach, describe, expect, it } from 'vitest'
import { proxy } from '../proxy'

describe('marketing proxy', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('adds noindex headers outside production', () => {
    process.env.VERCEL_ENV = 'preview'

    const response = proxy({} as never)

    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('does not add noindex headers in production', () => {
    process.env.VERCEL_ENV = 'production'

    const response = proxy({} as never)

    expect(response.headers.get('X-Robots-Tag')).toBeNull()
  })
})
