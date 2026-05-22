import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each test resets modules to clear the in-memory token/inflight cache between runs.

describe('getPayatToken', () => {
  const TOKEN_URL = 'https://go.payat.co.za/yapi/v1/oauth/token'

  function mockOkResponse(body: object) {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      body: { cancel: vi.fn() },
    })
  }

  function mockErrorResponse(status: number, bodyText = '') {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status,
      json: async () => { throw new SyntaxError('not json') },
      text: async () => bodyText,
      body: { cancel: vi.fn() },
    })
  }

  describe('with all Pay@ env vars set', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.stubEnv('PAYAT_TOKEN_URL', TOKEN_URL)
      vi.stubEnv('PAYAT_CLIENT_ID', 'client-test-id')
      vi.stubEnv('PAYAT_CLIENT_SECRET', 'test-secret')
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    it('returns access_token on a valid 200 response', async () => {
      mockOkResponse({ access_token: 'tok-abc', expires_in: 3600 })
      const { getPayatToken } = await import('@/lib/payat/token')
      await expect(getPayatToken()).resolves.toBe('tok-abc')
    })

    it('replicates the production bug: HTML body from a 302→/app redirect causes PayatTokenError(invalid_response)', async () => {
      // Root cause: PAYAT_TOKEN_URL was set to https://go.payat.co.za/oauth/token which
      // 302-redirects to the Pay@ frontend. fetch() follows the redirect, gets an HTML
      // page, JSON.parse throws SyntaxError → PayatTokenError('invalid_response') →
      // "We could not reach Pay@ right now. Please try again in a minute."
      // Fix: set PAYAT_TOKEN_URL to https://go.payat.co.za/yapi/v1/oauth/token (returns 401
      // on bad credentials instead of a redirect).
      ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0') },
        text: async () => '<html><body>Pay@ App</body></html>',
        body: { cancel: vi.fn() },
      })
      const { getPayatToken } = await import('@/lib/payat/token')
      const { PayatTokenError } = await import('@/lib/payat/token')
      await expect(getPayatToken()).rejects.toMatchObject({
        name: 'PayatTokenError',
        stage: 'invalid_response',
      })
      await expect(getPayatToken()).rejects.toBeInstanceOf(PayatTokenError)
    })

    it('throws PayatTokenError(fetch_failed, 401) on invalid credentials', async () => {
      mockErrorResponse(401, '{"error":"invalid_client"}')
      const { getPayatToken } = await import('@/lib/payat/token')
      await expect(getPayatToken()).rejects.toMatchObject({
        name: 'PayatTokenError',
        stage: 'fetch_failed',
        status: 401,
      })
    })

    it('throws PayatTokenError(fetch_failed) on network timeout', async () => {
      ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      )
      const { getPayatToken } = await import('@/lib/payat/token')
      await expect(getPayatToken()).rejects.toMatchObject({
        name: 'PayatTokenError',
        stage: 'fetch_failed',
      })
    })

    it('throws PayatTokenError(invalid_response) when response omits access_token', async () => {
      mockOkResponse({ expires_in: 3600 })
      const { getPayatToken } = await import('@/lib/payat/token')
      await expect(getPayatToken()).rejects.toMatchObject({
        name: 'PayatTokenError',
        stage: 'invalid_response',
      })
    })

    it('reuses cached token within TTL without a second fetch', async () => {
      mockOkResponse({ access_token: 'tok-cached', expires_in: 3600 })
      const { getPayatToken } = await import('@/lib/payat/token')
      const first = await getPayatToken()
      const second = await getPayatToken()
      expect(first).toBe('tok-cached')
      expect(second).toBe('tok-cached')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('when PAYAT_TOKEN_URL is not set', () => {
    // Separate describe so this beforeEach stubs TOKEN_URL to '' as the FIRST
    // stub for this key — vi.stubEnv cannot override a same-key stub that was
    // already set in an outer beforeEach, so a fresh describe is required.
    beforeEach(() => {
      vi.resetModules()
      vi.stubEnv('PAYAT_TOKEN_URL', '')
      vi.stubEnv('PAYAT_CLIENT_ID', 'client-test-id')
      vi.stubEnv('PAYAT_CLIENT_SECRET', 'test-secret')
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    it('throws PayatConfigError before making any HTTP request', async () => {
      const { getPayatToken } = await import('@/lib/payat/token')
      const { PayatConfigError } = await import('@/lib/payat/payment')
      await expect(getPayatToken()).rejects.toBeInstanceOf(PayatConfigError)
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
