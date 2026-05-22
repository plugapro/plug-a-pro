import { type NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redact(val: string | undefined, prefixLen = 8) {
  if (!val) return '(MISSING)'
  return `${val.slice(0, prefixLen)}... (${val.length} chars)`
}

function generateClientAccountNumber() {
  const hex = randomBytes(7).toString('hex')
  const num = BigInt('0x' + hex) % BigInt('100000000000000')
  return num.toString().padStart(14, '0')
}

export async function GET(request: NextRequest) {
  const diagKey = process.env.PAYAT_DIAG_KEY?.trim()
  if (!diagKey || request.nextUrl.searchParams.get('key') !== diagKey) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const tokenUrl = process.env.PAYAT_TOKEN_URL?.trim() ?? ''
  const clientId = process.env.PAYAT_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.PAYAT_CLIENT_SECRET?.trim() ?? ''
  const apiBase = (process.env.PAYAT_API_BASE?.trim() ?? '').replace(/\/$/, '')
  const merchantIdentifier = process.env.PAYAT_MERCHANT_IDENTIFIER?.trim() ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? ''

  const env = {
    PAYAT_TOKEN_URL: tokenUrl || '(MISSING)',
    PAYAT_API_BASE: apiBase || '(MISSING)',
    PAYAT_CLIENT_ID: redact(clientId),
    PAYAT_CLIENT_SECRET: clientSecret ? `SET (${clientSecret.length} chars)` : '(MISSING)',
    PAYAT_MERCHANT_IDENTIFIER: merchantIdentifier || '(MISSING)',
    NEXT_PUBLIC_APP_URL: appUrl || '(MISSING)',
  }

  // ── Step 1: OAuth token (client_credentials) ───────────────────────────────
  let token: string | null = null
  let tokenResult: Record<string, unknown>
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>
      token = typeof data.access_token === 'string' ? data.access_token : null
      tokenResult = {
        status: res.status,
        ok: true,
        hasToken: !!token,
        tokenLength: token?.length ?? 0,
        expiresIn: data.expires_in,
        // scope tells us which endpoints the issued token can reach
        scope: data.scope ?? data.scopes ?? '(not returned)',
      }
    } else {
      const body = await res.text()
      tokenResult = { status: res.status, ok: false, body: body.slice(0, 300) }
    }
  } catch (err) {
    tokenResult = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }

  if (!token) {
    return NextResponse.json({ env, token: tokenResult, rtp: 'skipped (no token)' })
  }

  if (!apiBase) {
    return NextResponse.json({ env, token: tokenResult, rtp: 'skipped (PAYAT_API_BASE missing)' })
  }

  // ── Step 2: RTP create via /integrator/rtp/create/single/{id} (production flow) ──
  // This is the exact endpoint and payload shape the production app uses.
  // Scope required: rtp:create:single
  let rtpResult: Record<string, unknown>
  const rtpEndpoint = `${apiBase}/integrator/rtp/create/single/${merchantIdentifier}`
  try {
    const res = await fetch(rtpEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientAccountNumber: generateClientAccountNumber(),
        amount: 10000,
        minimumAmount: 10000,
        maximumAmount: 10000,
        description: 'Plug A Pro credits top-up (diagnostic)',
        clientReferenceNumber: `diag-${Date.now()}`,
        merchantDisplayName: 'Plug A Pro',
        notificationNumber: '+27820000000',
        customerNameSurname: 'Diagnostic Test',
        customerMobileNumber: '+27820000000',
        customerEmail: 'diag@plugapro.co.za',
        daysValid: 3,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.text()
    rtpResult = {
      endpoint: rtpEndpoint,
      status: res.status,
      ok: res.ok,
      body: body.slice(0, 800),
    }
  } catch (err) {
    rtpResult = {
      endpoint: rtpEndpoint,
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }
  }

  return NextResponse.json({ env, token: tokenResult, rtp: rtpResult })
}
