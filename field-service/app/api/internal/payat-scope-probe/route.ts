// ─── Internal: Pay@ OAuth scope probe ────────────────────────────────────────
//
// Answers one question without touching production behaviour: does our OAuth
// client hold the `rtp:read` grant? Pay@'s OpenAPI spec (go.payat.co.za/yapi/
// v3/api-docs/integrator) defines rtp:read as a clientCredentials scope on
// GET /integrator/rtp/read/{merchantIdentifier}/{clientAccountNumber}, so the
// grant is testable at the token endpoint — no support ticket needed to find
// out where we stand.
//
// The production rail keeps requesting PAYAT_SCOPES (default rtp:create:single)
// and is never affected: this route builds its own token request out of band.
// That ordering discipline exists because Pay@ enforces scopes at the TOKEN
// endpoint — widening PAYAT_SCOPES before the grant exists breaks RTP creation
// for every provider (rollout hazard H1 in the 2026-07-29 reliability plan).
//
//   ?scope=...    scopes to request (default "rtp:create:single rtp:read")
//   ?account=...  optionally read one RTP with the probe token: proves the
//                 scope end-to-end and captures the response shape. Returns
//                 lifecycle fields only — never customer name/phone/email.
//
// Side effects at Pay@: one token issuance, at most one read. No RTP is ever
// created here. The access token itself is never returned or logged.
//
// Secured by CRON_SECRET (Authorization: Bearer <secret>), same as the crons.

import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_PROBE_SCOPE = 'rtp:create:single rtp:read'
// Same contract as the production readers (lib/payat/read.ts:54,
// lib/payat-go/client.ts:537,606): 1-14 numeric digits.
const ACCOUNT_PATTERN = /^\d{1,14}$/
const FETCH_TIMEOUT_MS = 8_000

function present(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? `SET (${trimmed.length} chars)` : '(MISSING)'
}

function maskAccount(value: string) {
  return value.length <= 4 ? '***' : `${value.slice(0, 2)}...${value.slice(-2)} (${value.length} digits)`
}

/**
 * Granted scopes as reported by the server. Token endpoints usually echo a
 * `scope` field; when they omit it, a JWT access token's payload often carries
 * `scope` / `scp` / `authorities`. Only those claims are ever extracted — the
 * token and the rest of its payload stay inside this function.
 */
function extractGrantedScope(body: Record<string, unknown>): string {
  const direct = body.scope ?? body.scopes
  if (typeof direct === 'string' && direct.trim()) return direct
  if (Array.isArray(direct)) return direct.join(' ')

  const token = body.access_token
  if (typeof token === 'string') {
    const parts = token.split('.')
    if (parts.length === 3 && parts[1]) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
        for (const key of ['scope', 'scp', 'authorities'] as const) {
          const claim = payload[key]
          if (typeof claim === 'string' && claim.trim()) return claim
          if (Array.isArray(claim)) return claim.join(' ')
        }
      } catch {
        // Opaque or non-JWT token: nothing to extract.
      }
    }
  }
  return '(not reported)'
}

/**
 * The probe exists to surface invalid_scope / invalid_client, so those OAuth
 * fields are reported — but only those. Everything else in an error body is
 * reduced to the HTTP status.
 */
function describeOauthError(status: number, body: Record<string, unknown>): string {
  const code = typeof body.error === 'string' ? body.error.slice(0, 60) : null
  const description = typeof body.error_description === 'string' ? body.error_description.slice(0, 200) : null
  if (code && description) return `${code}: ${description}`
  if (code) return code
  return `HTTP ${status} (no OAuth error fields in body)`
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tokenUrl = process.env.PAYAT_TOKEN_URL?.trim() ?? ''
  const clientId = process.env.PAYAT_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.PAYAT_CLIENT_SECRET?.trim() ?? ''
  const apiBase = (process.env.PAYAT_API_BASE?.trim() ?? '').replace(/\/$/, '')
  const merchantIdentifier = process.env.PAYAT_MERCHANT_IDENTIFIER?.trim() ?? ''

  const env = {
    PAYAT_TOKEN_URL: tokenUrl || '(MISSING)',
    PAYAT_API_BASE: apiBase || '(MISSING)',
    PAYAT_CLIENT_ID: present(clientId),
    PAYAT_CLIENT_SECRET: present(clientSecret),
    PAYAT_MERCHANT_IDENTIFIER: present(merchantIdentifier),
  }
  if (!tokenUrl || !clientId || !clientSecret) {
    return NextResponse.json({ env, error: 'missing Pay@ credentials in this environment' }, { status: 500 })
  }

  const requestedScope = request.nextUrl.searchParams.get('scope')?.trim() || DEFAULT_PROBE_SCOPE
  const account = request.nextUrl.searchParams.get('account')?.trim() || null
  if (account && !ACCOUNT_PATTERN.test(account)) {
    return NextResponse.json({ env, error: 'account must be 6-20 digits' }, { status: 400 })
  }

  // ── Token probe (out of band; production PAYAT_SCOPES untouched) ──────────
  let tokenResponse: Response
  try {
    tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: requestedScope }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    return NextResponse.json({
      env,
      token: { ok: false, requestedScope, error: err instanceof Error ? err.name : 'fetch_failed' },
    })
  }

  const rawBody = await tokenResponse.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    // Non-JSON error page; the status code still tells the story.
  }

  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token : null
  const token = {
    ok: tokenResponse.ok && Boolean(accessToken),
    httpStatus: tokenResponse.status,
    requestedScope,
    grantedScope: accessToken ? extractGrantedScope(parsed) : null,
    expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : null,
    // Only allowlisted OAuth error fields, never the raw body: a pathological
    // non-2xx response could still echo an access_token, and this route
    // guarantees tokens never leave it (same discipline as lib/payat/token.ts).
    error: tokenResponse.ok ? null : describeOauthError(tokenResponse.status, parsed),
  }

  if (!accessToken || !account) {
    return NextResponse.json({ env, token })
  }

  // ── Optional read with the probe token ─────────────────────────────────────
  if (!apiBase || !merchantIdentifier) {
    return NextResponse.json({ env, token, read: { ok: false, error: 'PAYAT_API_BASE or PAYAT_MERCHANT_IDENTIFIER missing' } })
  }

  try {
    const readResponse = await fetch(
      `${apiBase}/integrator/rtp/read/${merchantIdentifier}/${account}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!readResponse.ok) {
      // 403 = scope refused in practice; 404 = scope fine, no such RTP.
      // Never echo the body — Pay@ read errors can carry response content.
      return NextResponse.json({ env, token, read: { ok: false, httpStatus: readResponse.status } })
    }
    const body = (await readResponse.json()) as Record<string, unknown>
    return NextResponse.json({
      env,
      token,
      read: {
        ok: true,
        httpStatus: readResponse.status,
        clientAccountNumber: maskAccount(account),
        // Lifecycle + amounts only. customerNameSurname, customerMobileNumber,
        // customerEmail, paymentLink and notificationMobileNumber stay out.
        accountState: typeof body.accountState === 'string' ? body.accountState : '(missing)',
        amount: typeof body.amount === 'number' ? body.amount : null,
        amountPaid: typeof body.amountPaid === 'number' ? body.amountPaid : null,
        clientReferenceNumber: typeof body.clientReferenceNumber === 'string' ? body.clientReferenceNumber : null,
        dateTimePaid: typeof body.dateTimePaid === 'string' ? body.dateTimePaid : null,
        dateTimeExpire: typeof body.dateTimeExpire === 'string' ? body.dateTimeExpire : null,
      },
    })
  } catch (err) {
    return NextResponse.json({
      env,
      token,
      read: { ok: false, error: err instanceof Error ? err.name : 'fetch_failed' },
    })
  }
}
