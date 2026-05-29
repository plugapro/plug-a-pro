import { computeSmileSignature, currentIsoTimestamp } from './signing'
import type { SmileLinksCreateRequest, SmileLinksCreateResponse } from './types'

const SMILE_LINKS_PATH = '/v1/smile_links'

// Versioned so Smile support tickets and forensic queries can trace a request
// back to a specific adapter build.  Prefer npm_package_version (set by pnpm
// when scripts run), then the short SHA of the Vercel build, with a literal
// fallback for environments where neither is set (e.g. some test runners).
const SOURCE_SDK_VERSION =
  process.env.npm_package_version ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  '1.0.0'

// EVD verification_method. Public docs show 'doc_verification' for the
// DocV family; EVD is the same string with the product flag set at the
// partner level. If sandbox probe in
// docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md finds a
// different value, override here.
const EVD_VERIFICATION_METHOD = 'doc_verification'

const CREATE_TIMEOUT_MS = 10_000
const DISABLE_TIMEOUT_MS = 5_000

// In production, SMILE_ID_BASE_URL must point to one of Smile's known hosts.
// Prevents silently misrouting all verifications to the sandbox (or to an
// attacker-controlled host) if the env var is misconfigured during a deploy.
// Test/dev environments are unrestricted so vitest can hit local mocks.
const KNOWN_SMILE_HOSTS: ReadonlySet<string> = new Set([
  'https://api.smileidentity.com',
  'https://testapi.smileidentity.com',
])

function validateBaseUrl(url: string): void {
  if (process.env.NODE_ENV !== 'production') return
  const normalized = url.toLowerCase().replace(/\/$/, '')
  if (!KNOWN_SMILE_HOSTS.has(normalized)) {
    throw new Error(
      `SMILE_ID_BASE_URL must be one of ${[...KNOWN_SMILE_HOSTS].join(', ')} in production; got ${url}`,
    )
  }
}

export class SmileApiError extends Error {
  constructor(public readonly status: number, public readonly responseBody: string) {
    super(`Smile API error ${status}: ${responseBody.slice(0, 200)}`)
    this.name = 'SmileApiError'
  }
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`${key} is required`)
  return v
}

function signedHeader() {
  const timestamp = currentIsoTimestamp()
  const signature = computeSmileSignature(timestamp)
  return {
    partner_id: requireEnv('SMILE_ID_PARTNER_ID'),
    timestamp,
    signature,
  }
}

export type CreateSmileLinkInput = {
  verificationId: string
  providerId: string | null
  partnerJobId: string
  callbackUrl: string
  expiresAt: Date
}

export type CreateSmileLinkResult = {
  linkUrl: string
  refId: string
  expiresAt: string | null
}

export async function createSmileLink(input: CreateSmileLinkInput): Promise<CreateSmileLinkResult> {
  const baseUrl = requireEnv('SMILE_ID_BASE_URL')
  validateBaseUrl(baseUrl)

  const body: SmileLinksCreateRequest = {
    ...signedHeader(),
    source_sdk: 'rest_api',
    source_sdk_version: SOURCE_SDK_VERSION,
    name: `Plug A Pro - ${input.verificationId}`,
    company_name: 'Plug A Pro',
    id_types: [{
      country: 'ZA',
      id_type: 'IDENTITY_CARD',
      verification_method: EVD_VERIFICATION_METHOD,
    }],
    callback_url: input.callbackUrl,
    is_single_use: true,
    partner_params: {
      user_id: input.providerId ?? input.verificationId,
      job_id: input.partnerJobId,
      job_type: 11,
      verification_id: input.verificationId,
    },
    expires_at: input.expiresAt.toISOString(),
  }

  let resp: Response
  try {
    resp = await fetch(`${baseUrl}${SMILE_LINKS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new SmileApiError(0, `request timeout after ${CREATE_TIMEOUT_MS}ms`)
    }
    throw err
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new SmileApiError(resp.status, text)
  }

  const json = await resp.json() as SmileLinksCreateResponse
  if (typeof json.link_url !== 'string' || typeof json.ref_id !== 'string') {
    throw new SmileApiError(resp.status, `unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return {
    linkUrl: json.link_url,
    refId: json.ref_id,
    expiresAt: json.expires_at ?? null,
  }
}

export type DisableSmileLinkResult = {
  acknowledged: boolean
}

// Best-effort: orchestrator does not retry disable; caller treats failure as non-fatal.
// On non-2xx or timeout we log and return acknowledged:false so callers can continue
// the verification cancel flow without blocking.
export async function disableSmileLink(refId: string): Promise<DisableSmileLinkResult> {
  const baseUrl = requireEnv('SMILE_ID_BASE_URL')
  validateBaseUrl(baseUrl)

  let resp: Response
  try {
    resp = await fetch(`${baseUrl}${SMILE_LINKS_PATH}/${encodeURIComponent(refId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...signedHeader(),
        is_disabled: true,
      }),
      signal: AbortSignal.timeout(DISABLE_TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'timeout'
      : 'network_error'
    console.warn('[smile-id] disableSmileLink failed', { refId, reason })
    return { acknowledged: false }
  }

  if (!resp.ok) {
    console.warn('[smile-id] disableSmileLink non-2xx', { refId, status: resp.status })
  }
  return { acknowledged: resp.ok }
}
