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
  | 'provider_journey'  // registered provider: availability + job status via WA

// All possible step names (namespaced by flow)
export type FlowStep =
  // Shared
  | 'welcome'
  // Job request flow
  | 'browse_categories'
  | 'collect_name'              // captures name on first job request
  | 'collect_address'           // addr_same / addr_new decision for returning customers
  | 'collect_address_street'    // structured: street / unit
  | 'collect_address_suburb'    // structured: suburb → then prompts city
  | 'confirm_address'           // receives city text, assembles + confirms full address
  | 'collect_availability'
  | 'confirm_job_request'
  | 'job_request_submitted'
  | 'notify_me'                 // no providers in area — join waitlist
  // Registration (provider onboarding)
  | 'reg_start'           // shows intro + yes/no — entry point
  | 'reg_collect_name'
  | 'reg_collect_skills'
  | 'reg_collect_skills_more'
  | 'reg_collect_area'
  | 'reg_collect_experience'
  | 'reg_collect_availability'
  | 'reg_collect_city'         // city selection within chosen province
  | 'reg_collect_region'       // first region selection within chosen city
  | 'reg_collect_region_more'  // select additional regions
  | 'reg_collect_evidence'
  | 'reg_confirm'
  | 'reg_pending'
  | 'reg_edit_field'          // field-level edit selection
  // Status flow
  | 'status_show'
  | 'status_pick'   // disambiguation step: customer choosing between multiple active requests
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
  // Provider journey (registered provider WhatsApp interactions)
  | 'pj_menu'
  | 'pj_toggle_available'
  | 'pj_job_list'
  | 'pj_job_detail'
  | 'pj_status_update'
  | 'pj_status_confirm'
  | 'pj_problem_report'
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
  address?: string              // assembled display string (set after all 3 parts entered)
  addressStreet?: string        // structured part 1
  addressSuburb?: string        // structured part 2
  addressCity?: string          // structured part 3
  hasSavedAddress?: boolean     // true = a previous address was offered to reuse
  availabilityNote?: string     // free-text preferred availability from customer
  jobRequestId?: string
  matchId?: string
  category?: string

  // Structured address (job request)
  addressLocationNodeId?: string | null  // SUBURB node ID, resolved from free-text suburb
  addressRawSuburb?: string | null       // quarantined raw text, kept for ops review

  // Reschedule
  rescheduleBookingId?: string
  rescheduleReason?: string

  // Registration
  name?: string
  skills?: string[]
  serviceAreas?: string[]
  experience?: string           // "Less than 1 year" | "1–3 years" | "3–5 years" | "5+ years"
  availability?: string[]       // ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
  evidenceNote?: string

  // Structured service areas (registration)
  locationNodeIds?: string[]    // selected region/suburb node IDs for provider
  selectedRegionLabels?: string[]   // display labels for selected regions
  provinceKey?: string              // normalized province key
  cityId?: string                   // LocationNode ID of selected city
  city?: string                     // city label
  province?: string                 // province label

  // Provider job management
  pendingJobId?: string
  declineReason?: string

  // Provider journey
  availableNow?: boolean
  activeJobId?: string
  statusUpdate?: string

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
