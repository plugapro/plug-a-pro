type TokenCache = {
  token: string
  expiresAt: number
}

let cache: TokenCache | null = null
// In-flight promise prevents concurrent cold-start requests from each
// independently calling the Pay@ token endpoint (thundering-herd).
let inflight: Promise<string> | null = null

function requirePayatEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error('PAYAT_CLIENT_ID and PAYAT_CLIENT_SECRET must be set')
  }
  return value
}

function getTokenUrl() {
  const value = process.env.PAYAT_TOKEN_URL?.trim()
  if (!value) throw new Error('PAYAT_TOKEN_URL must be set')
  return value
}

async function fetchToken(): Promise<string> {
  const clientId = requirePayatEnv('PAYAT_CLIENT_ID')
  const clientSecret = requirePayatEnv('PAYAT_CLIENT_SECRET')

  const response = await fetch(getTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(5_000),
  })

  if (!response.ok) {
    // Never log the response body — it may echo credentials or sensitive context.
    if (process.env.NODE_ENV !== 'production') {
      const body = await response.text()
      console.debug('[payat-token] token fetch failed body (dev only)', body)
    } else {
      await response.body?.cancel()
    }
    throw new Error(`Pay@ token fetch failed: HTTP ${response.status}`)
  }

  const data = await response.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token || !Number.isFinite(data.expires_in)) {
    throw new Error('Pay@ token response did not include access_token and expires_in')
  }
  const expiresIn = Number(data.expires_in)

  cache = {
    token: data.access_token,
    // Subtract 60 seconds for clock skew so callers do not reuse near-expired tokens.
    expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000,
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
}
