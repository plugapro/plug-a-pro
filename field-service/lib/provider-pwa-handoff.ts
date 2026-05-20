type ProviderHandoffLead = {
  id: string
  status: string
  jobRequestId: string
  jobRequest?: {
    match?: {
      id: string
      status: string
      providerCompletedAt?: Date | null
      plannedArrivalStart?: Date | null
    } | null
  } | null
}

export type ProviderWhatsappHandoffEvent =
  | 'start_application'
  | 'continue_application'
  | 'more_info_required'
  | 'application_approved'
  | 'application_status'
  | 'new_opportunity'
  | 'customer_selected_you'
  | 'job_accepted'
  | 'confirm_arrival'
  | 'complete_job'
  | 'credits_low'
  | 'credits_history'

export const PROVIDER_PWA_HANDOFF_MAP: Record<ProviderWhatsappHandoffEvent, string> = {
  start_application: '/provider/application',
  continue_application: '/provider/application',
  more_info_required: '/provider/application',
  application_approved: '/provider',
  application_status: '/provider/application',
  new_opportunity: '/provider/leads',
  customer_selected_you: '/provider/leads',
  job_accepted: '/provider/jobs',
  confirm_arrival: '/provider/jobs',
  complete_job: '/provider/jobs',
  credits_low: '/provider/credits',
  credits_history: '/provider/credits',
}

const PROVIDER_WHATSAPP_HANDOFF_EVENTS = new Set<ProviderWhatsappHandoffEvent>(
  Object.keys(PROVIDER_PWA_HANDOFF_MAP) as ProviderWhatsappHandoffEvent[],
)

export function isProviderWhatsappHandoffEvent(
  value: string | null | undefined,
): value is ProviderWhatsappHandoffEvent {
  return Boolean(value && PROVIDER_WHATSAPP_HANDOFF_EVENTS.has(value as ProviderWhatsappHandoffEvent))
}

/**
 * Job-scoped events that should resolve to the specific job handover page
 * when a jobId or lead is available. Falls back to the jobs list when not.
 */
const JOB_SCOPED_EVENTS: ReadonlySet<ProviderWhatsappHandoffEvent> = new Set([
  'job_accepted',
  'confirm_arrival',
  'complete_job',
])

/**
 * Resolve the PWA destination for a WhatsApp handoff event.
 *
 * State-aware: if the lead has already moved past the opportunity stage
 * (e.g. ACCEPTED) the resolver returns the job-specific handover screen
 * rather than the stale opportunity preview, so old WhatsApp links always
 * land on the current state.
 *
 * jobId may be supplied independently of a lead token for job-scoped
 * events (confirm_arrival, complete_job) when the caller already has the
 * resolved job/jobRequest identifier.
 */
export function resolveProviderPwaHandoffPath(params: {
  event: ProviderWhatsappHandoffEvent | string
  token?: string | null
  lead?: ProviderHandoffLead | null
  /** Canonical job or jobRequest id — used to build a job-specific deep link */
  jobId?: string | null
}) {
  const event = isProviderWhatsappHandoffEvent(params.event)
    ? params.event
    : 'new_opportunity'
  const token = params.token?.trim()
  const lead = params.lead ?? null

  if (token && lead) {
    if (lead.status === 'ACCEPTED' && lead.jobRequest?.match) {
      return `/leads/access/${encodeURIComponent(token)}`
    }

    if (lead.status === 'SENT' || lead.status === 'VIEWED') {
      return `/leads/access/${encodeURIComponent(token)}`
    }

    if (lead.status === 'DECLINED' || lead.status === 'EXPIRED') {
      return `/leads/access/${encodeURIComponent(token)}`
    }
  }

  if (token && (event === 'new_opportunity' || event === 'customer_selected_you')) {
    return `/leads/access/${encodeURIComponent(token)}`
  }

  // For job-scoped events, resolve to the specific job handover page when we
  // have enough information, so that confirm_arrival and complete_job links
  // are not left pointing at the generic jobs list.
  if (JOB_SCOPED_EVENTS.has(event)) {
    // Prefer an explicit jobId, then fall back to the lead's jobRequestId.
    const resolvedJobId = params.jobId?.trim() || lead?.jobRequestId?.trim()
    if (resolvedJobId) {
      if (token) {
        return `/provider/jobs/${encodeURIComponent(resolvedJobId)}/handover?token=${encodeURIComponent(token)}`
      }
      return `/provider/jobs/${encodeURIComponent(resolvedJobId)}/handover`
    }
  }

  return PROVIDER_PWA_HANDOFF_MAP[event]
}
