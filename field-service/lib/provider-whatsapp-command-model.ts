import type { FlowName, FlowStep } from './whatsapp-flows/types'

export type ProviderWhatsappState =
  | 'application_capture'
  | 'application_submitted'
  | 'pending_review'
  | 'approved_idle'
  | 'opportunity_review'
  | 'interest_capture_callout'
  | 'interest_capture_arrival'
  | 'interest_capture_rate'
  | 'customer_selected_pending_acceptance'
  | 'accepted_job_active'
  | 'arrival_confirmation'
  | 'job_execution'
  | 'job_completion'
  | 'support'

export type ProviderWhatsappCommand = {
  command: string
  aliases: string[]
  flow: FlowName
  step: FlowStep
  replyId?: string
  state: ProviderWhatsappState
}

// Canonical provider command routing. The WhatsApp bot uses this as the single
// text-command map for provider operations so new commands do not fork the flow.
export const PROVIDER_WHATSAPP_COMMANDS: ProviderWhatsappCommand[] = [
  {
    command: 'menu',
    aliases: ['menu', 'hi', 'hello', 'start', 'provider menu', 'home'],
    flow: 'provider_journey',
    step: 'pj_menu',
    state: 'approved_idle',
  },
  {
    command: 'credits',
    aliases: ['credits', 'credit', 'balance', 'wallet', 'credit history', 'credits history', 'wallet history'],
    flow: 'provider_journey',
    step: 'pj_credits',
    replyId: 'provider_check_status',
    state: 'approved_idle',
  },
  {
    command: 'jobs',
    aliases: ['jobs', 'my jobs', 'myjobs', 'my work', 'active jobs'],
    flow: 'provider_journey',
    step: 'pj_job_list',
    replyId: 'provider_my_jobs',
    state: 'accepted_job_active',
  },
  {
    command: 'status',
    aliases: ['status', 'provider status', 'application status'],
    flow: 'provider_journey',
    step: 'pj_provider_status',
    replyId: 'provider_status',
    state: 'approved_idle',
  },
  {
    command: 'profile',
    aliases: ['profile', 'my profile', 'services', 'areas', 'service areas'],
    flow: 'provider_journey',
    step: 'pj_profile',
    replyId: 'provider_profile',
    state: 'approved_idle',
  },
  {
    command: 'availability',
    aliases: ['availability', 'available', 'online', 'go available'],
    flow: 'provider_journey',
    step: 'pj_toggle_available',
    replyId: 'provider_go_available',
    state: 'approved_idle',
  },
  {
    command: 'unavailable',
    aliases: [
      'unavailable', 'offline', 'not available', 'pause', 'pause leads',
      'break', 'back later', 'back in 1 hour', 'back in 2 hours', 'back in an hour', 'back tomorrow',
    ],
    flow: 'provider_journey',
    step: 'pj_toggle_available',
    replyId: 'provider_pause_leads',
    state: 'approved_idle',
  },
  {
    command: 'help',
    aliases: ['help', 'support'],
    flow: 'provider_journey',
    step: 'pj_support',
    replyId: 'provider_support',
    state: 'support',
  },
  {
    command: 'opportunities',
    aliases: ['opportunities', 'available jobs', 'find work', 'find jobs', 'leads'],
    flow: 'provider_journey',
    step: 'pj_available_leads',
    replyId: 'provider_available_jobs',
    state: 'opportunity_review',
  },
  {
    command: 'interested',
    aliases: ['interested'],
    flow: 'provider_journey',
    step: 'pj_available_leads',
    replyId: 'provider_available_jobs',
    state: 'opportunity_review',
  },
  {
    command: 'not_interested',
    aliases: ['not interested', 'pass'],
    flow: 'provider_journey',
    step: 'pj_available_leads',
    replyId: 'provider_available_jobs',
    state: 'opportunity_review',
  },
  {
    command: 'accept_job',
    aliases: ['accept job', 'accept selected job'],
    flow: 'provider_journey',
    step: 'pj_job_list',
    replyId: 'provider_my_jobs',
    state: 'customer_selected_pending_acceptance',
  },
  {
    command: 'decline',
    aliases: ['decline', 'decline job'],
    flow: 'provider_journey',
    step: 'pj_available_leads',
    replyId: 'provider_available_jobs',
    state: 'opportunity_review',
  },
  {
    command: 'on_the_way',
    aliases: ['on the way', 'otw', 'en route'],
    flow: 'provider_journey',
    step: 'pj_job_list',
    replyId: 'provider_my_jobs',
    state: 'job_execution',
  },
  {
    command: 'arrived',
    aliases: ['arrived', 'i arrived', "i've arrived"],
    flow: 'provider_journey',
    step: 'pj_job_list',
    replyId: 'provider_my_jobs',
    state: 'job_execution',
  },
  {
    command: 'start',
    aliases: ['start job', 'start work'],
    flow: 'provider_journey',
    step: 'pj_job_list',
    replyId: 'provider_my_jobs',
    state: 'job_execution',
  },
  {
    command: 'complete',
    aliases: ['complete', 'complete job', 'done', 'finish job'],
    flow: 'provider_journey',
    step: 'pj_job_list',
    replyId: 'provider_my_jobs',
    state: 'job_completion',
  },
  {
    command: 'issue',
    aliases: ['issue', 'problem', 'report issue'],
    flow: 'provider_journey',
    step: 'pj_problem_report',
    state: 'support',
  },
  {
    command: 'register',
    aliases: ['register', 'apply', 'join'],
    flow: 'registration',
    step: 'reg_start',
    state: 'application_capture',
  },
  {
    command: 'redeem_voucher',
    aliases: [
      'redeem',
      'voucher',
      'redeem voucher',
      'claim voucher',
      'my voucher',
      'enter voucher',
      'voucher code',
    ],
    flow: 'provider_journey' as FlowName,
    step: 'pj_redeem_voucher' as FlowStep,
    replyId: 'provider_redeem_voucher',
    state: 'approved_idle' as ProviderWhatsappState,
  },
]

function normalizeProviderCommandText(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function resolveProviderWhatsappCommand(text: string | null | undefined) {
  const normalized = normalizeProviderCommandText(text ?? '')
  if (!normalized) return null

  // Prefer exact alias matches before prefix matches to prevent shorter aliases
  // (e.g. "start" in the menu command) from shadowing longer multi-word commands
  // (e.g. "start job" in the job-execution command).
  const exactMatch = PROVIDER_WHATSAPP_COMMANDS.find((command) =>
    command.aliases.some((alias) => normalized === alias),
  )
  if (exactMatch) return exactMatch

  return PROVIDER_WHATSAPP_COMMANDS.find((command) =>
    command.aliases.some((alias) => normalized.startsWith(`${alias} `)),
  ) ?? null
}

export function getProviderWhatsappStateNames() {
  return [
    'application_capture',
    'application_submitted',
    'pending_review',
    'approved_idle',
    'opportunity_review',
    'interest_capture_callout',
    'interest_capture_arrival',
    'interest_capture_rate',
    'customer_selected_pending_acceptance',
    'accepted_job_active',
    'arrival_confirmation',
    'job_execution',
    'job_completion',
    'support',
  ] as const
}
