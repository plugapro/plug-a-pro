import { computeSmileSignature, currentIsoTimestamp } from './signing'
import type { SmileLinksCreateRequest, SmileLinksCreateResponse } from './types'

const SMILE_LINKS_PATH = '/v1/smile_links'
const SOURCE_SDK_VERSION = '1.0.0'

// EVD verification_method per sandbox probe (Task 2 notes). Public docs show
// 'doc_verification' for the DocV family; EVD is the same string with the
// product flag set at the partner level. Override here only if the probe finds
// a different value.
const EVD_VERIFICATION_METHOD = 'doc_verification'

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

  const body: SmileLinksCreateRequest = {
    ...signedHeader(),
    source_sdk: 'rest_api',
    source_sdk_version: SOURCE_SDK_VERSION,
    name: `Plug A Pro — ${input.verificationId}`,
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

  const resp = await fetch(`${baseUrl}${SMILE_LINKS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new SmileApiError(resp.status, text)
  }

  const json = await resp.json() as SmileLinksCreateResponse
  return {
    linkUrl: json.link_url,
    refId: json.ref_id,
    expiresAt: json.expires_at ?? null,
  }
}

export type DisableSmileLinkResult = {
  acknowledged: boolean
}

export async function disableSmileLink(refId: string): Promise<DisableSmileLinkResult> {
  const baseUrl = requireEnv('SMILE_ID_BASE_URL')

  const resp = await fetch(`${baseUrl}${SMILE_LINKS_PATH}/${encodeURIComponent(refId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...signedHeader(),
      is_disabled: true,
    }),
  })

  return { acknowledged: resp.ok }
}
