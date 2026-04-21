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
  | 'collect_address_street'    // captures free-text street / unit (addressLine1)
  // Structured location selection — replaces old suburb/city free-text steps
  | 'addr_select_province'      // list-based province selection
  | 'addr_select_city'          // list-based city selection (filtered by province)
  | 'addr_select_region'        // list-based region selection (filtered by city)
  | 'addr_select_suburb'        // list-based suburb selection (filtered by region, derives postalCode)
  | 'addr_confirm'              // show full derived address + yes/no confirmation
  // Legacy steps — kept only for in-flight conversations at deploy time
  | 'collect_address_suburb'    // LEGACY: typed suburb → then prompts city
  | 'confirm_address'           // LEGACY: receives typed city, assembles + confirms full address
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
  | 'reg_collect_region_more'    // select additional regions
  | 'reg_collect_suburb_select'  // numbered multi-select of suburbs within chosen region
  | 'reg_collect_suburb_text'    // free-text suburb fallback when location_nodes has no data
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
  address?: string              // assembled display string (set once full structured address is confirmed)
  // Legacy free-text address parts (kept for old in-flight conversations)
  addressStreet?: string        // legacy: free-text street
  addressSuburb?: string        // legacy: free-text suburb
  addressCity?: string          // legacy: free-text city
  hasSavedAddress?: boolean     // true = a previous address was offered to reuse
  availabilityNote?: string     // free-text preferred availability from customer
  jobRequestId?: string
  matchId?: string
  category?: string

  // Structured address — new customer job-request flow
  addressLine1?: string              // street address captured as free text
  addrProvinceKey?: string           // province slug (used to query cities)
  addrProvinceLabel?: string         // display label, e.g. "Gauteng"
  addrCityId?: string                // LocationNode ID of selected city
  addrCityLabel?: string             // display label, e.g. "Johannesburg"
  addrRegionId?: string              // LocationNode ID of selected region
  addrRegionLabel?: string           // display label, e.g. "JHB North"
  addrLocationNodeId?: string | null // selected SUBURB node ID (from list selection)
  addrSuburbLabel?: string           // display label of selected suburb
  addrPostalCode?: string            // derived from suburb node, never typed
  addrPage?: number                  // current page index for paged lists (reset on step transition)

  // Legacy structured address fields (old path — do not populate from new flow)
  addressLocationNodeId?: string | null  // SUBURB node ID resolved from free-text suburb
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
  evidenceFileUrls?: string[]       // blob URLs of uploaded proof images/documents

  // Structured service areas (registration)
  locationNodeIds?: string[]         // selected region/suburb node IDs for provider
  selectedRegionLabels?: string[]    // display labels for selected regions
  selectedSuburbLabels?: string[]    // display labels for selected suburbs (drill-down)
  regionId?: string                  // region node ID being drilled into for suburb selection
  regionLabel?: string               // region display label during suburb drill-down
  suburbPage?: number                // current page offset for suburb paged list
  suburbPageTotal?: number           // total suburb count for the region
  suburbOptions?: Array<{ id: string; label: string }>  // suburb options for current page context
  provinceKey?: string               // normalized province key
  cityId?: string                    // LocationNode ID of selected city
  city?: string                      // city label
  province?: string                  // province label

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
