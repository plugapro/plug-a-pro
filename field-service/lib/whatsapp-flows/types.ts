// ─── WhatsApp conversation flow types ────────────────────────────────────────

import type { InboundReply } from '../whatsapp-interactive'

// All possible flow names
export type FlowName =
  | 'idle'
  | 'booking'
  | 'registration'
  | 'status'
  | 'help'

// All possible step names (namespaced by flow)
export type FlowStep =
  // Shared
  | 'welcome'
  // Booking flow
  | 'browse_categories'
  | 'browse_services'
  | 'collect_address'
  | 'confirm_address'
  | 'select_slot'
  | 'confirm_booking'
  | 'await_payment'
  // Registration flow
  | 'reg_collect_name'
  | 'reg_collect_skills'
  | 'reg_collect_area'
  | 'reg_confirm'
  | 'reg_pending'
  // Status flow
  | 'status_show'
  // Help
  | 'help_menu'
  // Terminal
  | 'done'
  | 'cancelled'

// Per-conversation accumulated data (grows as the flow progresses)
export interface ConversationData {
  // Booking
  selectedCategory?: string
  selectedServiceId?: string
  selectedServiceName?: string
  selectedServicePrice?: number
  address?: string
  selectedSlotId?: string
  selectedSlotLabel?: string

  // Registration
  name?: string
  skills?: string[]
  serviceAreas?: string[]

  // Shared
  customerId?: string
  bookingId?: string
}

// The full conversation context passed to each flow handler
export interface FlowContext {
  phone: string        // E.164 — the customer or technician's WhatsApp number
  businessId: string
  step: FlowStep
  data: ConversationData
  reply: InboundReply  // what they just said / tapped
}

// What a flow handler returns
export interface FlowResult {
  nextStep: FlowStep
  nextData?: Partial<ConversationData>
}
