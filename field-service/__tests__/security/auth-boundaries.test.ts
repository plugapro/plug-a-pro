/**
 * Security regression tests — auth boundaries and CSRF protection.
 *
 * These tests document the intended auth contract for key helpers and route
 * handlers. They run against the module implementations directly (unit) — NOT
 * integration. For full E2E security testing, use the Playwright smoke suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── CSRF helper ───────────────────────────────────────────────────────────────

describe('verifyRequestOrigin', () => {
  it('rejects a mismatched origin', async () => {
    const { verifyRequestOrigin } = await import('../../lib/csrf')
    const req = new Request('http://app.example.com/api/action', {
      method: 'POST',
      headers: { origin: 'http://evil.example.com', host: 'app.example.com' },
    })
    expect(verifyRequestOrigin(req, [])).toBe(false)
  })

  it('allows same-origin request', async () => {
    const { verifyRequestOrigin } = await import('../../lib/csrf')
    const req = new Request('http://app.example.com/api/action', {
      method: 'POST',
      headers: { origin: 'http://app.example.com', host: 'app.example.com' },
    })
    expect(verifyRequestOrigin(req, [])).toBe(true)
  })

  it('allows request with no Origin header (server-to-server)', async () => {
    const { verifyRequestOrigin } = await import('../../lib/csrf')
    const req = new Request('http://app.example.com/api/action', {
      method: 'POST',
      headers: { host: 'app.example.com' },
    })
    expect(verifyRequestOrigin(req, [])).toBe(true)
  })

  it('allows request from an explicitly whitelisted origin', async () => {
    const { verifyRequestOrigin } = await import('../../lib/csrf')
    const req = new Request('http://app.example.com/api/action', {
      method: 'POST',
      headers: { origin: 'https://trusted.partner.com', host: 'app.example.com' },
    })
    expect(verifyRequestOrigin(req, ['https://trusted.partner.com'])).toBe(true)
  })

  it('rejects a malformed origin (not a valid URL)', async () => {
    const { verifyRequestOrigin } = await import('../../lib/csrf')
    const req = new Request('http://app.example.com/api/action', {
      method: 'POST',
      headers: { origin: 'not-a-url', host: 'app.example.com' },
    })
    expect(verifyRequestOrigin(req, [])).toBe(false)
  })

  it('rejects an origin that only shares a prefix but not the host', async () => {
    const { verifyRequestOrigin } = await import('../../lib/csrf')
    const req = new Request('http://app.example.com/api/action', {
      method: 'POST',
      headers: { origin: 'http://app.example.com.evil.net', host: 'app.example.com' },
    })
    expect(verifyRequestOrigin(req, [])).toBe(false)
  })
})

// ── API response helpers ──────────────────────────────────────────────────────

describe('apiError / apiSuccess', () => {
  it('apiError returns the correct status and envelope', async () => {
    const { apiError } = await import('../../lib/api-response')
    const res = apiError('NOT_FOUND', 'Resource not found', 404)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatchObject({
      code: 'NOT_FOUND',
      category: 'not_found',
      message: 'Resource not found',
      retryable: false,
      suggested_actions: ['Check the requested resource and try again.'],
      context: {},
    })
    expect(body.error.reference_id).toMatch(/^PAP-\d{8}-[A-Z0-9]{6}$/)
    expect(body.error.referenceId).toBe(body.error.reference_id)
    expect(Date.parse(body.error.timestamp)).not.toBeNaN()
  })

  it('apiError includes the provided reference ID', async () => {
    const { apiError } = await import('../../lib/api-response')
    const res = apiError('SERVER_ERROR', 'Unexpected error', 500, 'PAP-20260518-ABCDEF')
    const body = await res.json()
    expect(body.error.reference_id).toBe('PAP-20260518-ABCDEF')
    expect(body.error.referenceId).toBe('PAP-20260518-ABCDEF')
    expect(body.error.category).toBe('internal')
    expect(body.error.retryable).toBe(true)
  })

  it('apiSuccess wraps data and defaults to 200', async () => {
    const { apiSuccess } = await import('../../lib/api-response')
    const res = apiSuccess({ id: '123' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ data: { id: '123' } })
  })

  it('apiSuccess accepts a custom status code', async () => {
    const { apiSuccess } = await import('../../lib/api-response')
    const res = apiSuccess({ id: '123' }, 201)
    expect(res.status).toBe(201)
  })
})

// ── requireAdmin contract ─────────────────────────────────────────────────────

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('is a function exported from lib/auth', async () => {
    // Structural check — ensures the export exists and has not been accidentally removed.
    // Integration-level auth tests live in __tests__/api/auth/.
    const auth = await import('../../lib/auth')
    expect(typeof auth.requireAdmin).toBe('function')
  })

  it('requireAdminApi is a function exported from lib/auth', async () => {
    const auth = await import('../../lib/auth')
    expect(typeof auth.requireAdminApi).toBe('function')
  })

  it('getSession is a function exported from lib/auth', async () => {
    const auth = await import('../../lib/auth')
    expect(typeof auth.getSession).toBe('function')
  })
})
