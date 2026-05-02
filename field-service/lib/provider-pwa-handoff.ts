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
  | 'new_opportunity'
  | 'customer_selected_you'
  | 'job_accepted'
  | 'confirm_arrival'
  | 'complete_job'
  | 'credits_low'

export const PROVIDER_PWA_HANDOFF_MAP: Record<ProviderWhatsappHandoffEvent, string> = {
  start_application: '/provider',
  continue_application: '/provider',
  more_info_required: '/provider',
  application_approved: '/provider',
  new_opportunity: '/provider/leads',
  customer_selected_you: '/provider/leads',
  job_accepted: '/provider/jobs',
  confirm_arrival: '/provider/jobs',
  complete_job: '/provider/jobs',
  credits_low: '/provider/credits',
}

export function resolveProviderPwaHandoffPath(params: {
  event: ProviderWhatsappHandoffEvent
  token?: string | null
  lead?: ProviderHandoffLead | null
}) {
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

  if (token && (params.event === 'new_opportunity' || params.event === 'customer_selected_you')) {
    return `/leads/access/${encodeURIComponent(token)}`
  }

  return PROVIDER_PWA_HANDOFF_MAP[params.event]
}
