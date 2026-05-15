// lib/payat/token.ts
// Fetches and caches the Pay@ OAuth access token.
// Uses HTTP Basic Auth (the only method Pay@'s YAPI API accepts).

// In-memory cache — survives for the lifetime of the serverless instance
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Returns a valid Pay@ access token, fetching a new one only when
 * the cached one has expired (or is within 60 seconds of expiry).
 */
export async function getPayatToken(): Promise<string> {
  // Return the cached token if it's still good
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const clientId     = process.env.PAYAT_CLIENT_ID!;
  const clientSecret = process.env.PAYAT_CLIENT_SECRET!;
  const tokenUrl     = process.env.PAYAT_TOKEN_URL || 'https://go.payat.co.za/yapi/oauth/token';

  if (!clientId || !clientSecret) {
    throw new Error('PAYAT_CLIENT_ID and PAYAT_CLIENT_SECRET must be set');
  }

  // Pay@ requires HTTP Basic Auth — base64(client_id:client_secret)
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(tokenUrl, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
    },
    body:  new URLSearchParams({ grant_type: 'client_credentials' }),
    cache: 'no-store', // never serve a stale token from HTTP cache
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pay@ token fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Pay@ token response missing access_token: ${JSON.stringify(data)}`);
  }

  // Cache the token — default expiry is 3599s (~1 hour)
  const expiresIn = data.expires_in ?? 3600;
  cachedToken = {
    value:     data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return cachedToken.value;
}
