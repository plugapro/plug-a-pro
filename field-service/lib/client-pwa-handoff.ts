import type { JobRequestStatus } from '@prisma/client'
import { ensureJobRequestAccessToken, resolveJobRequestAccessToken } from './job-request-access'
import { resolveClientPwaScreenForState, type ClientPwaScreen } from './client-pwa-state'

export type ClientPwaHandoffIntent =
  | 'request_form'
  | 'photo_upload'
  | 'review_submit'
  | 'matching_status'
  | 'provider_responses'
  | 'shortlist'
  | 'provider_profile'
  | 'provider_selected'
  | 'job_tracking'
  | 'completion_review'

export type ClientPwaHandoffView =
  | 'invalid_link'
  | 'expired_link'
  | 'request_review'
  | 'matching_status'
  | 'provider_responses_pending'
  | 'shortlist'
  | 'provider_confirmation'
  | 'job_tracking'
  | 'request_closed'

export type ClientPwaHandoffResolution = {
  status: 'active' | 'expired' | 'invalid'
  requestId: string | null
  originalIntent: ClientPwaHandoffIntent | null
  view: ClientPwaHandoffView
  path: string
  reason: string
}

// Convert the shared screen resolver into the existing token-page view names.
function viewForRequestStatus(status: JobRequestStatus): {
  view: ClientPwaHandoffView
  reason: string
} {
  const state = resolveClientPwaScreenForState({ requestStatus: status })
  return { view: handoffViewForScreen(state.screen), reason: state.reason }
}

function handoffViewForScreen(screen: ClientPwaScreen): ClientPwaHandoffView {
  switch (screen) {
    case 'request_form':
    case 'request_submitted':
      return 'request_review'
    case 'matching_progress':
      return 'matching_status'
    case 'providers_reviewing':
      return 'provider_responses_pending'
    case 'shortlist':
      return 'shortlist'
    case 'provider_confirmation':
      return 'provider_confirmation'
    case 'job_tracking':
    case 'active_job':
    case 'completion_review':
      return 'job_tracking'
    case 'cancelled':
    case 'expired':
    case 'client_home':
    case 'invalid_link':
      return 'request_closed'
  }
}

// Keep WhatsApp links on the canonical token route while allowing the page to render a state-specific view.
export function buildClientPwaTokenPath(token: string, view: ClientPwaHandoffView) {
  return `/requests/access/${encodeURIComponent(token)}?view=${encodeURIComponent(view)}`
}

// Resolve either a browser-safe token or a trusted server-side request id into the current PWA destination.
export async function resolveClientPwaHandoff(params: {
  token?: string | null
  jobRequestId?: string | null
  intent?: ClientPwaHandoffIntent | null
}): Promise<ClientPwaHandoffResolution> {
  const originalIntent = params.intent ?? null
  let token = params.token ?? null

  if (!token && params.jobRequestId) {
    try {
      const access = await ensureJobRequestAccessToken(params.jobRequestId)
      token = access.token
    } catch {
      return {
        status: 'invalid',
        requestId: params.jobRequestId,
        originalIntent,
        view: 'invalid_link',
        path: '/requests/access/recovery?reason=invalid',
        reason: 'request_reference_not_found',
      }
    }
  }

  if (!token) {
    return {
      status: 'invalid',
      requestId: params.jobRequestId ?? null,
      originalIntent,
      view: 'invalid_link',
      path: '/requests/access/recovery?reason=invalid',
      reason: 'missing_token_or_request_reference',
    }
  }

  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status === 'invalid' || !resolved.jobRequest) {
    return {
      status: 'invalid',
      requestId: null,
      originalIntent,
      view: 'invalid_link',
      path: '/requests/access/recovery?reason=invalid',
      reason: 'token_not_found',
    }
  }

  if (resolved.status === 'expired') {
    return {
      status: 'expired',
      requestId: resolved.jobRequest.id,
      originalIntent,
      view: 'expired_link',
      path: '/requests/access/recovery?reason=expired',
      reason: 'token_expired_or_revoked',
    }
  }

  const target = viewForRequestStatus(resolved.jobRequest.status)
  return {
    status: 'active',
    requestId: resolved.jobRequest.id,
    originalIntent,
    view: target.view,
    path: buildClientPwaTokenPath(token, target.view),
    reason: target.reason,
  }
}
