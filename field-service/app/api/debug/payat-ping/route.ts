import { type NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function describeSecret(val: string | undefined) {
  return val ? `SET (${val.length} chars)` : '(MISSING)'
}

function maskIdentifier(val: string | undefined) {
  if (!val) return '(MISSING)'
  if (val.length <= 4) return '***'
  return `${val.slice(0, 2)}***${val.slice(-2)} (${val.length} chars)`
}

function redactEndpoint(endpoint: string, merchantIdentifier: string) {
  return merchantIdentifier
    ? endpoint.replaceAll(merchantIdentifier, '[MERCHANT_IDENTIFIER_REDACTED]')
    : endpoint
}

function getPayatScopes() {
  return process.env.PAYAT_SCOPES?.trim() || 'rtp:create:single'
}

function generateClientAccountNumber() {
  const hex = randomBytes(7).toString('hex')
  const num = BigInt('0x' + hex) % BigInt('100000000000000')
  return num.toString().padStart(14, '0')
}

function buildRtpBody(suffix: string) {
  return {
    clientAccountNumber: generateClientAccountNumber(),
    amount: 10000,
    minimumAmount: 10000,
    maximumAmount: 10000,
    description: 'Plug A Pro credits top-up (diagnostic)',
    clientReferenceNumber: `diag-${Date.now()}-${suffix}`.slice(0, 30),
    merchantDisplayName: 'Plug A Pro',
    notificationNumber: '+27820000000',
    customerNameSurname: 'Diagnostic Test',
    customerMobileNumber: '+27820000000',
    customerEmail: 'diag@plugapro.co.za',
    daysValid: 3,
  }
}

async function requestPayatToken(params: {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope?: string
}) {
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (params.scope) body.set('scope', params.scope)

  const res = await fetch(params.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')}`,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  })

  const text = await res.text()
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = null
  }

  return {
    status: res.status,
    ok: res.ok,
    token: typeof data?.access_token === 'string' ? data.access_token : null,
    result: res.ok
      ? {
          status: res.status,
          ok: true,
          hasToken: typeof data?.access_token === 'string',
          tokenLength: typeof data?.access_token === 'string' ? data.access_token.length : 0,
          expiresIn: data?.expires_in,
          scope: data?.scope ?? data?.scopes ?? '(not returned)',
        }
      : {
          status: res.status,
          ok: false,
          body: text.slice(0, 300),
        },
  }
}

async function createRtp(params: {
  endpoint: string
  token: string
  merchantIdentifier: string
  suffix: string
}) {
  try {
    const res = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRtpBody(params.suffix)),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.text()
    return {
      endpoint: redactEndpoint(params.endpoint, params.merchantIdentifier),
      status: res.status,
      ok: res.ok,
      body: body.slice(0, 800),
    }
  } catch (err) {
    return {
      endpoint: redactEndpoint(params.endpoint, params.merchantIdentifier),
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }
  }
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
    PAYAT_CLIENT_ID: describeSecret(clientId),
    PAYAT_CLIENT_SECRET: describeSecret(clientSecret),
    PAYAT_MERCHANT_IDENTIFIER: maskIdentifier(merchantIdentifier),
    NEXT_PUBLIC_APP_URL: appUrl || '(MISSING)',
  }

  // ── Step 1: OAuth token (client_credentials) ───────────────────────────────
  let token: string | null = null
  let tokenResult: Record<string, unknown>
  try {
    const tokenResponse = await requestPayatToken({
      tokenUrl,
      clientId,
      clientSecret,
      scope: getPayatScopes(),
    })
    token = tokenResponse.token
    tokenResult = tokenResponse.result
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
  const rtpEndpoint = `${apiBase}/integrator/rtp/create/single/${merchantIdentifier}`
  let rtpResult: Record<string, unknown>
  try {
    rtpResult = await createRtp({
      endpoint: rtpEndpoint,
      token,
      merchantIdentifier,
      suffix: 'base',
    })
  } catch (err) {
    rtpResult = {
      endpoint: redactEndpoint(rtpEndpoint, merchantIdentifier),
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }
  }

  if (request.nextUrl.searchParams.get('variants') === '1') {
    const variants: Record<string, unknown>[] = []

    const unscopedToken = await requestPayatToken({ tokenUrl, clientId, clientSecret })
    const unscopedEntry: Record<string, unknown> = {
      name: 'basic_no_scope_integrator',
      token: unscopedToken.result,
      rtp: 'skipped (no token)',
    }
    if (unscopedToken.token) {
      unscopedEntry.rtp = await createRtp({
        endpoint: rtpEndpoint,
        token: unscopedToken.token,
        merchantIdentifier,
        suffix: 'noscope',
      })
    }
    variants.push(unscopedEntry)

    const scopedToken = await requestPayatToken({
      tokenUrl,
      clientId,
      clientSecret,
      scope: getPayatScopes(),
    })
    const scopedEntry: Record<string, unknown> = {
      name: 'basic_scope_integrator',
      token: scopedToken.result,
      rtp: 'skipped (no token)',
    }
    if (scopedToken.token) {
      scopedEntry.rtp = await createRtp({
        endpoint: rtpEndpoint,
        token: scopedToken.token,
        merchantIdentifier,
        suffix: 'scope',
      })
    }
    variants.push(scopedEntry)

    const merchantEntry: Record<string, unknown> = {
      name: 'basic_scope_merchant_endpoint',
      token: scopedToken.result,
      rtp: 'skipped (no token)',
    }
    if (scopedToken.token) {
      merchantEntry.rtp = await createRtp({
        endpoint: `${apiBase}/merchant/rtp/create/single`,
        token: scopedToken.token,
        merchantIdentifier,
        suffix: 'merchant',
      })
    }
    variants.push(merchantEntry)

    return NextResponse.json({ env, token: tokenResult, rtp: rtpResult, variants })
  }

  return NextResponse.json({ env, token: tokenResult, rtp: rtpResult })
}
