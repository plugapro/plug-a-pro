import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DIAG_KEY = 'pap-diag-20260522-x9k'

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('key') !== DIAG_KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const tokenUrl = process.env.PAYAT_TOKEN_URL?.trim() ?? ''
  const clientId = process.env.PAYAT_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.PAYAT_CLIENT_SECRET?.trim() ?? ''
  const merchantId = process.env.PAYAT_MERCHANT_IDENTIFIER?.trim() ?? process.env.PAYAT_MERCHANT_ID?.trim() ?? ''

  const env = {
    PAYAT_TOKEN_URL: tokenUrl || '(MISSING)',
    PAYAT_CLIENT_ID: clientId ? `${clientId.slice(0, 10)}... (${clientId.length} chars)` : '(MISSING)',
    PAYAT_CLIENT_SECRET: clientSecret ? `SET (${clientSecret.length} chars)` : '(MISSING)',
    PAYAT_MERCHANT_IDENTIFIER: merchantId ? `${merchantId.slice(0, 6)}... (${merchantId.length} chars)` : '(MISSING)',
  }

  if (!tokenUrl || !clientId || !clientSecret) {
    return NextResponse.json({ ok: false, reason: 'missing_env', env })
  }

  let basicResult: Record<string, unknown>
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(8_000),
    })

    if (response.ok) {
      const data = await response.json() as Record<string, unknown>
      basicResult = {
        status: response.status,
        ok: true,
        hasToken: typeof data.access_token === 'string' && data.access_token.length > 0,
        tokenLength: typeof data.access_token === 'string' ? data.access_token.length : 0,
        expiresIn: data.expires_in,
      }
    } else {
      const body = await response.text()
      basicResult = {
        status: response.status,
        ok: false,
        responseHeaders: {
          'www-authenticate': response.headers.get('www-authenticate'),
          'content-type': response.headers.get('content-type'),
        },
        // Body is safe to echo here — this is a dev diagnostic and the token
        // endpoint error body never contains credentials.
        body: body.slice(0, 400),
      }
    }
  } catch (err) {
    basicResult = {
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }
  }

  return NextResponse.json({ env, basic: basicResult })
}
