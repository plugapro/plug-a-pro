type TokenCache = {
  token: string
  expiresAt: number
}

let cache: TokenCache | null = null

function requirePayatEnv(name: string) {
  // Keep Pay@ credentials server-only and fail before the outbound request.
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error('PAYAT_CLIENT_ID and PAYAT_CLIENT_SECRET must be set')
  }
  return value
}

function getTokenUrl() {
  // The Pay@ token URL is configurable because Pay@ docs are dashboard-led.
  const value = process.env.PAYAT_TOKEN_URL?.trim()
  if (!value) throw new Error('PAYAT_TOKEN_URL must be set')
  return value
}

export async function getPayatToken(): Promise<string> {
  // Use the module cache until the buffered expiry time has passed.
  if (cache && Date.now() < cache.expiresAt) {
    return cache.token
  }

  const clientId = requirePayatEnv('PAYAT_CLIENT_ID')
  const clientSecret = requirePayatEnv('PAYAT_CLIENT_SECRET')

  // Pay@ uses the OAuth2 client_credentials grant for server API access.
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
    throw new Error(`Pay@ token fetch failed: ${response.status} ${await response.text()}`)
  }

  const data = await response.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token || !Number.isFinite(data.expires_in)) {
    throw new Error('Pay@ token response did not include access_token and expires_in')
  }
  const expiresIn = Number(data.expires_in)

  // Subtract 60 seconds for clock skew so callers do not reuse near-expired tokens.
  cache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000,
  }

  return cache.token
}

export function invalidatePayatToken() {
  // Clear the cache after a 401 so the next call fetches a fresh token.
  cache = null
}
