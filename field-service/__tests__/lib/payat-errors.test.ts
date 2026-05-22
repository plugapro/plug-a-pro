import { describe, expect, it } from 'vitest'
import {
  PayatApiError,
  PayatConfigError,
  PayatTokenError,
} from '@/lib/payat'

/**
 * Locks in the typed-error contract the credits server action depends on.
 * Before this refactor, the action mapped Pay@ failures to user-facing
 * codes by string-matching the error message — fragile if Pay@ reworded
 * its HTTP error copy. These tests assert each class carries a stable
 * `name`, the discriminator fields the action layer relies on, and a
 * default message useful for log lines.
 */
describe('Pay@ typed errors', () => {
  it('PayatConfigError carries the env var name in its message', () => {
    const err = new PayatConfigError('PAYAT_CLIENT_SECRET')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PayatConfigError)
    expect(err.name).toBe('PayatConfigError')
    expect(err.message).toContain('PAYAT_CLIENT_SECRET')
    expect(err.message).toContain('must be set')
  })

  it('PayatTokenError fetch_failed carries the HTTP status', () => {
    const err = new PayatTokenError('fetch_failed', 401)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PayatTokenError)
    expect(err.name).toBe('PayatTokenError')
    expect(err.stage).toBe('fetch_failed')
    expect(err.status).toBe(401)
    expect(err.message).toMatch(/401/)
  })

  it('PayatTokenError invalid_response has no status and a descriptive message', () => {
    const err = new PayatTokenError('invalid_response')
    expect(err.stage).toBe('invalid_response')
    expect(err.status).toBeUndefined()
    expect(err.message).toMatch(/access_token/)
  })

  it('PayatApiError rtp_create_failed carries the HTTP status', () => {
    const err = new PayatApiError('rtp_create_failed', 503)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PayatApiError)
    expect(err.name).toBe('PayatApiError')
    expect(err.stage).toBe('rtp_create_failed')
    expect(err.status).toBe(503)
    expect(err.message).toMatch(/503/)
  })

  it('PayatApiError rtp_response_invalid has no status and signals a missing sourceReference', () => {
    const err = new PayatApiError('rtp_response_invalid')
    expect(err.stage).toBe('rtp_response_invalid')
    expect(err.status).toBeUndefined()
    expect(err.message).toMatch(/sourceReference/)
  })

  it('PayatApiError accepts an explicit detail override', () => {
    const err = new PayatApiError('rtp_create_failed', 400, 'custom detail')
    expect(err.message).toBe('custom detail')
  })

  it('the three classes are pairwise distinguishable by instanceof', () => {
    const config = new PayatConfigError('X')
    const token = new PayatTokenError('fetch_failed', 500)
    const api = new PayatApiError('rtp_create_failed', 500)

    expect(config instanceof PayatConfigError).toBe(true)
    expect(config instanceof PayatTokenError).toBe(false)
    expect(config instanceof PayatApiError).toBe(false)

    expect(token instanceof PayatTokenError).toBe(true)
    expect(token instanceof PayatConfigError).toBe(false)
    expect(token instanceof PayatApiError).toBe(false)

    expect(api instanceof PayatApiError).toBe(true)
    expect(api instanceof PayatConfigError).toBe(false)
    expect(api instanceof PayatTokenError).toBe(false)
  })
})
