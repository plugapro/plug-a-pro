// ─── WhatsApp conversation flow types ────────────────────────────────────────

import type { InboundReply } from '../whatsapp-interactive'

// All possible flow names
export type FlowName =
  | 'idle'
  | 'booking'
  | 'registration'
  | 'status'
  | 'reschedule'
  | 'cancel'
  | 'help'
  | 'technician_job'

// All possible step names (namespaced by flow)
export type FlowStep =
  // Shared
  | 'welcome'
  // Booking flow
  | 'browse_categories'
  | 'browse_services'
  | 'collect_name'              // captures name on first booking
  | 'collect_address'
  | 'confirm_address'
  | 'select_slot'
  | 'confirm_booking'
  | 'await_payment'
  | 'notify_me'                 // no slots — join waitlist
  // Registration (technician onboarding)
  | 'reg_collect_name'
  | 'reg_collect_skills'
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
  // Technician job management
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

  // Booking
  selectedCategory?: string
  selectedServiceId?: string
  selectedServiceName?: string
  selectedServicePrice?: number
  address?: string
  selectedSlotId?: string
  selectedSlotLabel?: string

  // Reschedule
  rescheduleBookingId?: string
  rescheduleReason?: string

  // Registration
  name?: string
  skills?: string[]
  serviceAreas?: string[]
  experience?: string           // "Less than 1 year" | "1–3 years" | "3–5 years" | "5+ years"
  availability?: string[]       // ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

  // Technician job management
  pendingJobId?: string

  // Shared
  customerId?: string
  bookingId?: string
}

// The full conversation context passed to each flow handler
export interface FlowContext {
  phone: string         // E.164 — the customer or technician's WhatsApp number
  businessId: string
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
