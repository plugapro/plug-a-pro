export type ProviderChannel = 'whatsapp' | 'pwa'

export type ProviderChannelSupport = 'existing' | 'planned' | 'optional'

export type ProviderChannelResponsibility = {
  id: string
  label: string
  core: boolean
  primaryChannel: ProviderChannel
  whatsapp: ProviderChannelSupport
  pwa: ProviderChannelSupport
  existingWhatsAppPath?: string
  optionalPwaPath?: string
  blocker?: string
}

// This matrix is the source of truth for the Provider WhatsApp-first channel model.
// Core actions must either have a WhatsApp path now, be planned for WhatsApp in
// this runner, or carry an explicit blocker that prevents silent PWA-only drift.
export const PROVIDER_CHANNEL_RESPONSIBILITIES: ProviderChannelResponsibility[] = [
  {
    id: 'application',
    label: 'Apply/register',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'registration provider application flow',
    optionalPwaPath: '/provider',
  },
  {
    id: 'profile_data_capture',
    label: 'Profile, service area, availability, and rate capture',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'registration provider application flow',
    optionalPwaPath: '/provider/profile and /provider/availability',
  },
  {
    id: 'application_status',
    label: 'Application status and approval/rejection messages',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'provider_application_status and provider application notifications',
    optionalPwaPath: '/provider',
  },
  {
    id: 'credit_balance',
    label: 'Check credit balance',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'provider menu and provider status',
    optionalPwaPath: '/provider/credits',
  },
  {
    id: 'opportunity_preview',
    label: 'View safe opportunity preview',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'planned',
    pwa: 'optional',
    existingWhatsAppPath: 'new-lead notification with signed preview CTA',
    optionalPwaPath: '/leads/access/[token]',
    blocker: 'Safe preview summary is not yet fully rendered inline in WhatsApp.',
  },
  {
    id: 'interest_response',
    label: 'Respond interested/not interested with call-out fee and ETA',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'planned',
    pwa: 'optional',
    existingWhatsAppPath: 'interested:<leadId> and not_interested:<leadId> intercepts',
    optionalPwaPath: '/api/provider/opportunities/[leadId]',
    blocker: 'Interested response still needs a WhatsApp capture state for fee and arrival before service submission.',
  },
  {
    id: 'selected_job_acceptance',
    label: 'Accept customer-selected job and spend one credit',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'confirm_accept:<leadId> selected-provider handler',
    optionalPwaPath: '/leads/access/[token]',
  },
  {
    id: 'full_customer_details',
    label: 'Receive full customer details after selected-job acceptance',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'selected-provider acceptance notification with inline customer details and signed job link',
    optionalPwaPath: '/provider/jobs/[jobId]/handover',
  },
  {
    id: 'arrival_confirmation',
    label: 'Confirm arrival time',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'provider WhatsApp text command: HH:MM or confirm arrival HH:MM',
    optionalPwaPath: '/leads/access/[token]',
  },
  {
    id: 'job_status_updates',
    label: 'Mark on the way, arrived, start job, and update active job status',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'provider_journey pj_upd_<jobId>_<status>',
    optionalPwaPath: '/provider/jobs/[id]',
  },
  {
    id: 'completion',
    label: 'Complete job with notes/photos',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'provider WhatsApp complete command with note and photo-or-skip capture',
    optionalPwaPath: '/leads/access/[token]',
  },
  {
    id: 'help_menu_status',
    label: 'Help, menu, and provider status',
    core: true,
    primaryChannel: 'whatsapp',
    whatsapp: 'existing',
    pwa: 'optional',
    existingWhatsAppPath: 'provider menu, provider_support, provider_status',
    optionalPwaPath: '/provider',
  },
  {
    id: 'credit_ledger_history',
    label: 'Credit ledger and payment history',
    core: false,
    primaryChannel: 'pwa',
    whatsapp: 'optional',
    pwa: 'existing',
    existingWhatsAppPath: 'provider_top_up_credits sends optional PWA link',
    optionalPwaPath: '/provider/credits',
  },
  {
    id: 'advanced_dashboard',
    label: 'Dashboard, document management, job history, and performance',
    core: false,
    primaryChannel: 'pwa',
    whatsapp: 'optional',
    pwa: 'existing',
    existingWhatsAppPath: 'provider_worker_portal sends optional PWA link',
    optionalPwaPath: '/provider',
  },
]

export function getCoreProviderChannelResponsibilities() {
  return PROVIDER_CHANNEL_RESPONSIBILITIES.filter((item) => item.core)
}

export function getProviderChannelResponsibility(id: string) {
  return PROVIDER_CHANNEL_RESPONSIBILITIES.find((item) => item.id === id) ?? null
}

export function coreProviderActionHasWhatsAppPath(item: ProviderChannelResponsibility) {
  return item.whatsapp === 'existing' || item.whatsapp === 'planned' || Boolean(item.blocker)
}
