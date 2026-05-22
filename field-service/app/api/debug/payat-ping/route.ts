import { NextResponse } from 'next/server'

// Temporary diagnostic endpoint — remove after credentials are confirmed.
const DIAG_KEY = 'pap-diag-20260522-x9k'

async function tryTokenFetch(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  method: 'form' | 'basic',
): Promise<{ status: number; body: string; wwwAuth: string | null }> {
  const headers: Record<string, string> = {}
  let body: BodyInit

  if (method === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams({ grant_type: 'client_credentials' })
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  }

  const res = await fetch(tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(8_000) })
  const text = await res.text()
  const redacted = text
    .replace(new RegExp(clientId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[CLIENT_ID]')
    .replace(new RegExp(clientSecret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[CLIENT_SECRET]')
    .slice(0, 400)
  return { status: res.status, body: redacted, wwwAuth: res.headers.get('www-authenticate') }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('key') !== DIAG_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const tokenUrl = process.env.PAYAT_TOKEN_URL?.trim() ?? ''
  const rawClientId = process.env.PAYAT_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.PAYAT_CLIENT_SECRET?.trim() ?? ''
  const strippedClientId = rawClientId.startsWith('client-') ? rawClientId.slice(7) : null

  const envCheck = {
    PAYAT_TOKEN_URL: tokenUrl || 'MISSING',
    PAYAT_CLIENT_ID_raw: rawClientId ? `${rawClientId.length} chars, prefix: ${rawClientId.slice(0, 14)}...` : 'MISSING',
    PAYAT_CLIENT_ID_stripped: strippedClientId ?? 'no client- prefix',
    PAYAT_CLIENT_SECRET: clientSecret ? `${clientSecret.length} chars, prefix: ${clientSecret.slice(0, 4)}...` : 'MISSING',
    PAYAT_MERCHANT_ID: process.env.PAYAT_MERCHANT_ID ?? 'MISSING',
  }

  if (!tokenUrl || !rawClientId || !clientSecret) {
    return NextResponse.json({ ok: false, errorType: 'PayatConfigError', env: envCheck })
  }

  // Also test the candidate token endpoint (no WWW-Auth header = may be the real issuer)
  const CANDIDATE_TOKEN_URL = 'https://go.payat.co.za/yapi/oauth/token'

  const urlsToTest: Array<{ label: string; url: string; id: string; method: 'form' | 'basic' }> = [
    { label: 'raw_form', url: tokenUrl, id: rawClientId, method: 'form' },
    { label: 'raw_basic', url: tokenUrl, id: rawClientId, method: 'basic' },
    ...(strippedClientId
      ? [
          { label: 'stripped_form', url: tokenUrl, id: strippedClientId, method: 'form' as const },
          { label: 'stripped_basic', url: tokenUrl, id: strippedClientId, method: 'basic' as const },
        ]
      : []),
    { label: 'candidate_raw_form', url: CANDIDATE_TOKEN_URL, id: rawClientId, method: 'form' },
    { label: 'candidate_raw_basic', url: CANDIDATE_TOKEN_URL, id: rawClientId, method: 'basic' },
    ...(strippedClientId
      ? [
          { label: 'candidate_stripped_form', url: CANDIDATE_TOKEN_URL, id: strippedClientId, method: 'form' as const },
          { label: 'candidate_stripped_basic', url: CANDIDATE_TOKEN_URL, id: strippedClientId, method: 'basic' as const },
        ]
      : []),
  ]

  const results: Record<string, object> = {}
  for (const { label, url, id, method } of urlsToTest) {
    try {
      const r = await tryTokenFetch(url, id, clientSecret, method)
      if (r.status === 200) {
        try {
          const data = JSON.parse(r.body) as { access_token?: string; expires_in?: number }
          return NextResponse.json({ ok: true, workingMethod: label, tokenUrl: url, tokenLength: data.access_token?.length, expiresIn: data.expires_in, env: envCheck })
        } catch {
          return NextResponse.json({ ok: true, workingMethod: label, tokenUrl: url, rawBody: r.body, env: envCheck })
        }
      }
      results[label] = { url, httpStatus: r.status, body: r.body, wwwAuth: r.wwwAuth }
    } catch (e) {
      results[label] = { url, httpStatus: 0, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return NextResponse.json({ ok: false, results, env: envCheck })
}
