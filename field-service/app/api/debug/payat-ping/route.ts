import { type NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DIAG_KEY = 'pap-diag-20260522-x9k'

function redact(val: string | undefined, prefixLen = 10) {
  if (!val) return '(MISSING)'
  return `${val.slice(0, prefixLen)}... (${val.length} chars)`
}

function generateClientAccountNumber() {
  const hex = randomBytes(7).toString('hex')
  const num = BigInt('0x' + hex) % BigInt('100000000000000')
  return num.toString().padStart(14, '0')
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('key') !== DIAG_KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const tokenUrl = process.env.PAYAT_TOKEN_URL?.trim() ?? ''
  const clientId = process.env.PAYAT_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.PAYAT_CLIENT_SECRET?.trim() ?? ''
  const merchantIdentifier = process.env.PAYAT_MERCHANT_IDENTIFIER?.trim() ?? ''
  const merchantId = process.env.PAYAT_MERCHANT_ID?.trim() ?? ''
  const apiBase = (process.env.PAYAT_API_BASE?.trim() ?? '').replace(/\/$/, '')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? ''

  const env = {
    PAYAT_TOKEN_URL: tokenUrl || '(MISSING)',
    PAYAT_API_BASE: apiBase || '(MISSING)',
    PAYAT_CLIENT_ID: redact(clientId),
    PAYAT_CLIENT_SECRET: clientSecret ? `SET (${clientSecret.length} chars)` : '(MISSING)',
    PAYAT_MERCHANT_IDENTIFIER: redact(merchantIdentifier, 6),
    PAYAT_MERCHANT_ID: redact(merchantId, 6),
    NEXT_PUBLIC_APP_URL: appUrl || '(MISSING)',
  }

  // ── Step 1: token ──────────────────────────────────────────────────────────
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
      tokenResult = { status: res.status, ok: true, hasToken: !!token, tokenLength: token?.length ?? 0, expiresIn: data.expires_in }
    } else {
      const body = await res.text()
      tokenResult = { status: res.status, ok: false, body: body.slice(0, 300) }
    }
  } catch (err) {
    tokenResult = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }

  if (!token) {
    return NextResponse.json({ env, token: tokenResult, generatecredentials: 'skipped (no token)', rtp: 'skipped (no token)' })
  }

  if (!apiBase) {
    return NextResponse.json({ env, token: tokenResult, generatecredentials: 'skipped (PAYAT_API_BASE missing)', rtp: 'skipped (PAYAT_API_BASE missing)' })
  }

  // ── Step 2: generatecredentials (idempotent registration) ─────────────────
  let generateCredentialsResult: Record<string, unknown>
  try {
    const res = await fetch(`${apiBase}/integrator/ecommerce/generatecredentials`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ merchantIdentifier, merchantId }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.text()
    generateCredentialsResult = {
      status: res.status,
      ok: res.ok || res.status === 409,
      body: body.slice(0, 400),
    }
  } catch (err) {
    generateCredentialsResult = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }

  const base = appUrl.replace(/\/$/, '')

  async function callRtp(label: string): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(
        `${apiBase}/integrator/ecommerce/rtp/create/single/${merchantIdentifier}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token!}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientAccountNumber: generateClientAccountNumber(),
            amount: '10000',
            minimumAmount: '10000',
            maximumAmount: '10000',
            description: `Plug A Pro credits top-up (diag-${label})`,
            clientReferenceNumber: `diag-${label}-${Date.now()}`,
            merchantDisplayName: 'Plug A Pro',
            notificationNumber: '+27820000000',
            customerNameSurname: 'Diag Test',
            customerMobileNumber: '+27820000000',
            customerEmail: 'diag@plugapro.co.za',
            daysValid: '3',
            merchantEcommerceStoreName: 'PLUGAPRO',
            successReturnUrl: `${base}/provider/credits?topup=success`,
            failureReturnUrl: `${base}/provider/credits?topup=failed`,
            cancelReturnUrl: `${base}/provider/credits?topup=cancelled`,
            lineItems: [{ description: 'Credits top-up', amount: '10000' }],
            multiPremium: 1,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      )
      const body = await res.text()
      return { status: res.status, ok: res.ok, body: body.slice(0, 800) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
    }
  }

  // ── Step 3a: RTP after generatecredentials (current production behaviour) ──
  const rtpAfterGenCreds = await callRtp('after-gencreds')

  // ── Step 3b: fresh token + RTP with NO generatecredentials call ────────────
  // Tests whether the merchant is already registered (e.g. via Pay@ portal).
  // If this returns 200 but step 3a returns 403, we can skip generatecredentials.
  let freshToken: string | null = null
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
      freshToken = typeof data.access_token === 'string' ? data.access_token : null
    }
  } catch { /* ignore */ }

  let rtpDirectResult: Record<string, unknown>
  if (freshToken) {
    // Temporarily swap the token reference so callRtp uses the fresh one
    token = freshToken
    rtpDirectResult = await callRtp('direct-no-gencreds')
  } else {
    rtpDirectResult = { skipped: 'could not obtain fresh token for direct test' }
  }

  return NextResponse.json({
    env,
    token: tokenResult,
    generatecredentials: generateCredentialsResult,
    rtp_after_gencreds: rtpAfterGenCreds,
    rtp_direct_no_gencreds: rtpDirectResult,
  })
}
