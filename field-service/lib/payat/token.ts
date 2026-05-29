import { PayatConfigError } from './payment'

type TokenCache = {
  token: string
  expiresAt: number
}

let cache: TokenCache | null = null
// In-flight promise prevents concurrent cold-start requests from each
// independently calling the Pay@ token endpoint (thundering-herd).
let inflight: Promise<string> | null = null

/**
 * Thrown when the Pay@ token endpoint rejects a request or returns a
 * response we cannot parse. Same purpose as PayatApiError but for the
 * auth endpoint - kept distinct so the action layer can show "could not
 * authenticate with Pay@" vs "Pay@ rejected the request" without
 * matching on free-text error strings.
 */
export class PayatTokenError extends Error {
  constructor(
    public readonly stage: 'fetch_failed' | 'invalid_response',
    public readonly status?: number,
    detail?: string,
  ) {
    super(
      detail ?? (
        stage === 'fetch_failed'
          ? `Pay@ token fetch failed: HTTP ${status ?? '?'}`
          : 'Pay@ token response did not include access_token and expires_in'
      ),
    )
    this.name = 'PayatTokenError'
  }
}

function requirePayatEnv(name: string) {
  // The previous implementation hard-coded the error message for any name,
  // which meant a missing PAYAT_CLIENT_SECRET produced a log line blaming
  // PAYAT_CLIENT_ID. Use the actual name with PayatConfigError so the log
  // and action-layer error mapping point at the right env var.
  const value = process.env[name]?.trim()
  if (!value) {
    throw new PayatConfigError(name)
  }
  return value
}

function getTokenUrl() {
  const value = process.env.PAYAT_TOKEN_URL?.trim()
  if (!value) throw new PayatConfigError('PAYAT_TOKEN_URL')
  return value
}

function getPayatScopes() {
  return process.env.PAYAT_SCOPES?.trim() || 'rtp:create:single'
}

async function fetchToken(): Promise<string> {
  const tokenUrl = getTokenUrl()
  const clientId = requirePayatEnv('PAYAT_CLIENT_ID')
  const clientSecret = requirePayatEnv('PAYAT_CLIENT_SECRET')
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: getPayatScopes(),
  })

  let response: Response
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown_error'
    throw new PayatTokenError(
      'fetch_failed',
      undefined,
      `Pay@ token request failed before response (${errorName})`,
    )
  }

  if (!response.ok) {
    // Never log the response body - it may echo credentials or sensitive context.
    if (process.env.NODE_ENV !== 'production') {
      const body = await response.text()
      console.debug('[payat-token] token fetch failed body (dev only)', body)
    } else {
      await response.body?.cancel()
    }
    throw new PayatTokenError('fetch_failed', response.status)
  }

  let data: { access_token?: string; expires_in?: number }
  try {
    data = await response.json() as { access_token?: string; expires_in?: number }
  } catch {
    throw new PayatTokenError('invalid_response')
  }
  if (!data.access_token || !Number.isFinite(data.expires_in)) {
    throw new PayatTokenError('invalid_response')
  }
  const expiresIn = Number(data.expires_in)

  cache = {
    token: data.access_token,
    // Subtract 60 s for clock skew. Floor at 10 s so sandbox tokens with very
    // short expires_in (< 60 s) do not produce expiresAt = now, which would
    // disable caching and cause a fetch on every request.
    expiresAt: Date.now() + Math.max((expiresIn - 60) * 1000, 10_000),
  }

  return cache.token
}

export async function getPayatToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt) return cache.token

  // Coalesce concurrent requests within this instance onto one in-flight fetch.
  if (inflight) return inflight

  inflight = fetchToken().finally(() => {
    inflight = null
  })

  return inflight
}

export function invalidatePayatToken() {
  cache = null
  // Clear the in-flight promise so the next caller kicks off a fresh token fetch
  // rather than awaiting a response that will be rejected (expired/revoked token).
  inflight = null
}
