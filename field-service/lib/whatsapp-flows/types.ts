// ─── WhatsApp conversation flow types ────────────────────────────────────────

import type { InboundReply } from '../whatsapp-interactive'

// All possible flow names
export type FlowName =
  | 'idle'
  | 'job_request'
  | 'registration'
  | 'status'
  | 'reschedule'
  | 'cancel'
  | 'help'
  | 'provider_job'

// All possible step names (namespaced by flow)
export type FlowStep =
  // Shared
  | 'welcome'
  // Job request flow
  | 'browse_categories'
  | 'collect_name'              // captures name on first job request
  | 'collect_address'
  | 'confirm_address'
  | 'collect_availability'
  | 'confirm_job_request'
  | 'job_request_submitted'
  | 'notify_me'                 // no providers in area — join waitlist
  // Registration (provider onboarding)
  | 'reg_collect_name'
  | 'reg_collect_skills'
  | 'reg_collect_skills_more'
  | 'reg_collect_area'
  | 'reg_collect_experience'
  | 'reg_collect_availability'
  | 'reg_confirm'
  | 'reg_pending'
  // Status flow
  | 'status_show'
  // Reschedule flow
  | 'reschedule_reason'
  | 'reschedule_select_slot'
  | 'reschedule_confirm'
  // Cancel flow
  | 'cancel_confirm'
  // Help flow
  | 'help_menu'
  | 'help_faq'
  // Provider job management
  | 'tech_job_list'
  | 'tech_job_view'
  | 'tech_job_confirm_accept'
  | 'tech_job_confirm_decline'
  // Terminal
  | 'done'
  | 'cancelled'

// Per-conversation accumulated data (grows as the flow progresses)
export interface ConversationData {
  // Customer identity
  customerName?: string
  isFirstBooking?: boolean      // true = show name-capture step

  // Job request
  selectedCategory?: string
  address?: string
  availabilityNote?: string     // free-text preferred availability from customer
  jobRequestId?: string
  matchId?: string
  category?: string

  // Reschedule
  rescheduleBookingId?: string
  rescheduleReason?: string

  // Registration
  name?: string
  skills?: string[]
  serviceAreas?: string[]
  experience?: string           // "Less than 1 year" | "1–3 years" | "3–5 years" | "5+ years"
  availability?: string[]       // ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

  // Provider job management
  pendingJobId?: string
  declineReason?: string

  // Shared
  customerId?: string
}

// The full conversation context passed to each flow handler
export interface FlowContext {
  phone: string         // E.164 — the customer or provider's WhatsApp number
  step: FlowStep
  data: ConversationData
  reply: InboundReply   // what they just said / tapped
  flow: FlowName
}

// What a flow handler returns
export interface FlowResult {
  nextStep: FlowStep
  nextData?: Partial<ConversationData>
}
