// ─── WhatsApp template registry ───────────────────────────────────────────────
// Each template must be registered and approved in Meta Business Manager.
// Template names here must exactly match the approved names in your WABA.
//
// When cloning for a new venture:
// 1. Register these templates in your Meta Business Account
// 2. Update the `name` fields below to match your approved template names
// 3. Get approval (usually 24-72h for new templates)
//
// Template categories used:
//   UTILITY    — transactional, post-purchase, service updates
//   MARKETING  — re-engagement, promotions (higher cost, lower delivery in DND)
//
// Variable notation: {{1}}, {{2}} … — positional, replaced at send time.

export const TEMPLATES = {

  // ─── Customer journey — booking lifecycle ─────────────────────────────────

  booking_confirmation: {
    name: 'booking_confirmation',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent immediately when a booking is confirmed and paid',
    // {{1}} customer name, {{2}} service, {{3}} date/window, {{4}} tracking URL
    example:
      'Hi {{1}}, your booking for {{2}} has been confirmed for {{3}}. Track your job: {{4}}',
  },

  booking_reminder: {
    name: 'booking_reminder',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 24h before the scheduled appointment',
    // {{1}} customer name, {{2}} service, {{3}} date/window
    example:
      'Hi {{1}}, just a reminder that your {{2}} appointment is tomorrow, {{3}}. Reply STOP to unsubscribe.',
  },

  booking_rescheduled: {
    name: 'booking_rescheduled',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a booking is moved to a new date/time',
    // {{1}} customer name, {{2}} service, {{3}} old slot, {{4}} new slot, {{5}} tracking URL
    example:
      'Hi {{1}}, your {{2}} booking has been moved from {{3}} to {{4}}. See updated booking: {{5}} — see you then!',
  },

  booking_cancelled: {
    name: 'booking_cancelled',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a booking is cancelled (by admin or customer)',
    // {{1}} customer name, {{2}} service, {{3}} refund note (or empty string)
    example:
      'Hi {{1}}, your {{2}} booking has been cancelled. {{3}}',
  },

  // ─── Customer journey — payment ───────────────────────────────────────────

  payment_reminder: {
    name: 'payment_reminder',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 2h after PENDING_PAYMENT status — resends payment link',
    // {{1}} customer name, {{2}} service, {{3}} amount, {{4}} payment URL
    example:
      'Hi {{1}}, your {{2}} booking is waiting for payment of {{3}}. Pay here — {{4}} — and your slot is confirmed.',
  },

  payment_received: {
    name: 'payment_received',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when payment clears (Peach webhook) — explicit confirmation',
    // {{1}} customer name, {{2}} amount, {{3}} service, {{4}} booking ref
    example:
      'Hi {{1}}, we received your payment of {{2}} for {{3}}. Booking confirmed — Ref: {{4}}. Thank you!',
  },

  // ─── Customer journey — technician dispatch ───────────────────────────────

  technician_assigned: {
    name: 'technician_assigned',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a specific technician is assigned/confirmed for a booking',
    // {{1}} customer name, {{2}} technician first name, {{3}} service, {{4}} date/window
    example:
      'Hi {{1}}, great news! {{2}} has been assigned to your {{3}} on {{4}}. They will contact you through this app only.',
  },

  technician_on_the_way: {
    name: 'technician_on_the_way',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when technician status changes to EN_ROUTE',
    // {{1}} customer name, {{2}} technician name, {{3}} ETA
    // Body registered with Meta 2026-04-08 (original body was rejected — leading param).
    example:
      'Hi {{1}}, your Plug A Pro technician {{2}} is heading your way now. Expected arrival in {{3}} — see you soon!',
  },

  technician_arrived: {
    name: 'technician_arrived',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when technician status changes to ARRIVED',
    // {{1}} customer name, {{2}} technician name
    example: 'Hi {{1}}, {{2}} has arrived at your location.',
  },

  extra_work_approval: {
    name: 'extra_work_approval',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when technician raises an extra work request',
    // {{1}} customer name, {{2}} description, {{3}} amount, {{4}} approval URL
    example:
      'Hi {{1}}, your technician has found additional work needed: {{2}} ({{3}}). Approve or decline here: {{4}}',
  },

  job_completed: {
    name: 'job_completed',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when job status changes to COMPLETED',
    // {{1}} customer name, {{2}} invoice URL
    example:
      'Hi {{1}}, your job has been completed. View your invoice here: {{2}}. Thank you for using our service!',
  },

  follow_up: {
    name: 'follow_up',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 24h after job completion to collect rating',
    // {{1}} customer name, {{2}} rating URL
    example:
      'Hi {{1}}, how did we do? Share your feedback here: {{2}}. We appreciate your support!',
  },

  // ─── Customer journey — quote flow ────────────────────────────────────────

  quote_ready: {
    name: 'quote_ready',
    language: 'en_ZA',
    // Meta classified this as MARKETING (not UTILITY) — category must match or policy gate is wrong.
    // Implication: customers must have whatsappMarketingOptIn=true to receive quote notifications.
    // If this blocks too many users, re-submit with a more transactional body to get UTILITY approval.
    category: 'MARKETING',
    description: 'Sent when admin completes a quote review',
    // {{1}} customer name, {{2}} service, {{3}} quoted price, {{4}} quote URL
    example:
      'Hi {{1}}, your quote for {{2}} is ready: {{3}}. View and accept here: {{4}}',
  },

  // ─── Customer re-engagement ───────────────────────────────────────────────

  slot_available: {
    name: 'slot_available',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent when a slot opens in the area a customer requested (Notify Me)',
    // {{1}} customer name, {{2}} service, {{3}} available slot (date/time), {{4}} booking URL
    example:
      'Good news {{1}}! A slot for {{2}} has opened for {{3}} in your area. Tap to book — {{4}} — slots go fast!',
  },

  no_technician_available: {
    name: 'no_technician_available',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when no technician can be matched — ask to reschedule or wait',
    // {{1}} customer name, {{2}} service, {{3}} original date, {{4}} reschedule URL
    example:
      'Hi {{1}}, we could not find a technician for your {{2}} on {{3}}. Please reschedule here — {{4}} — or we will contact you when one is available.',
  },

  // ─── Technician — job matching & dispatch ────────────────────────────────

  job_offer: {
    name: 'job_offer',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent to a technician when a new job is available for them to accept',
    // {{1}} tech first name, {{2}} service, {{3}} area (suburb/city), {{4}} date/window, {{5}} job URL
    example:
      'Hi {{1}}, new job: {{2}} in {{3}} on {{4}}. Tap to accept — {{5}} — good luck!',
  },

  technician_job_reminder: {
    name: 'technician_job_reminder',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to technician the evening before a confirmed job',
    // {{1}} tech first name, {{2}} service, {{3}} address, {{4}} time window, {{5}} job URL
    example:
      'Hi {{1}}, tomorrow: {{2}} job at {{3}} ({{4}}). View job details — {{5}} — see you on site!',
  },

  technician_payment_released: {
    name: 'technician_payment_released',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when payment for a completed job is released to the technician',
    // {{1}} tech first name, {{2}} amount, {{3}} service, {{4}} expected arrival (e.g. "1–2 business days")
    example:
      'Hi {{1}}, your payment of {{2}} for the {{3}} job has been released. Funds arrive in {{4}} — great work!',
  },

  // ─── Technician — onboarding ──────────────────────────────────────────────

  technician_application_received: {
    name: 'technician_application_received',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent as template confirmation after application submission',
    // {{1}} applicant name, {{2}} application ref
    example:
      'Hi {{1}}, we received your application to join Plug A Pro. Ref: {{2}}. We review all applications within 30 minutes and will update you here.',
  },

  technician_welcome: {
    name: 'technician_welcome',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent on approval — includes app link. Used as template for >24h outreach',
    // {{1}} tech name, {{2}} app URL
    example:
      'Welcome to Plug A Pro, {{1}}! Your application has been approved. Download the app — {{2}} — jobs are waiting!',
  },

  technician_application_declined: {
    name: 'technician_application_declined',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when application is not approved, with optional reason',
    // {{1}} applicant name, {{2}} reason or "at this time"
    example:
      'Hi {{1}}, thank you for applying to Plug A Pro. Unfortunately we are unable to onboard you {{2}}. You are welcome to apply again in the future.',
  },

  // ─── Provider wallet and paid lead lifecycle ─────────────────────────────

  wallet_low_balance: {
    name: 'wallet_low_balance',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a provider wallet reaches one remaining credit',
    // {{1}} remaining credits, {{2}} top-up amount, {{3}} credits issued
    example:
      'You have {{1}} Plug-A-Pro Credit left. Top up now so you do not miss new leads. {{2}} = {{3}} credits.',
  },

  wallet_zero_balance_lead: {
    name: 'wallet_zero_balance_lead',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a matched lead is available but the provider wallet has no credits',
    // {{1}} current credits, {{2}} minimum top-up amount
    example:
      'New matched lead available, but your wallet has {{1}} credits. Top up {{2}} to unlock this and future leads.',
  },

  wallet_payment_intent_created: {
    name: 'wallet_payment_intent_created',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after a provider creates a manual EFT wallet top-up intent',
    // {{1}} amount, {{2}} credits, {{3}} account name, {{4}} bank, {{5}} account number,
    // {{6}} branch code, {{7}} account type, {{8}} payment reference
    example:
      'Plug-A-Pro Credits top-up created: {{1}} = {{2}} credits. EFT to {{3}}, {{4}}, account {{5}}, branch {{6}}, {{7}}. Use exact reference: {{8}}. Credits are issued after Plug-A-Pro confirms the payment.',
  },

  wallet_payment_credited: {
    name: 'wallet_payment_credited',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after admin reconciliation credits a provider wallet top-up',
    // {{1}} credits issued
    example:
      'Payment received. Your wallet has been credited with {{1}} Plug-A-Pro Credits.',
  },

  wallet_payfast_topup_initiated: {
    name: 'wallet_payfast_topup_initiated',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after a provider initiates a Payfast gateway top-up (card, EFT, or SCode)',
    // {{1}} amount formatted (e.g. "R100.00"), {{2}} credits to issue
    // NOTE: WhatsApp template approval required before live sends succeed.
    example:
      'Your Plug-A-Pro top-up of {{1}} ({{2}} credits) has been initiated. Complete your payment on the checkout page. Credits will appear in your wallet once Payfast confirms payment.',
  },

  lead_unlock_provider: {
    name: 'lead_unlock_provider',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a provider after paid credits unlock customer lead details',
    // {{1}} category, {{2}} customer name, {{3}} customer phone, {{4}} address,
    // {{5}} preferred time, {{6}} details
    example:
      'Lead unlocked: {{1}}. Customer: {{2}}. Phone: {{3}}. Address: {{4}}. Preferred time: {{5}}. Details: {{6}}',
  },

  lead_unlock_customer_intro: {
    name: 'lead_unlock_customer_intro',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer after a provider unlocks their lead details',
    // {{1}} provider name
    example:
      'Good news — we matched you with {{1}}. They may contact you shortly.',
  },

} as const

export type TemplateName = keyof typeof TEMPLATES
