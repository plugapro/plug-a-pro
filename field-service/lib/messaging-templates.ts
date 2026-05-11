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
    // {{1}} customer name, {{2}} service, {{3}} date/window; tracking URL is a button
    example:
      'Hi {{1}}, your booking for {{2}} has been confirmed for {{3}}. Track your job using the button below.',
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
    // {{1}} customer name, {{2}} service, {{3}} old slot, {{4}} new slot; tracking URL is a button
    example:
      'Hi {{1}}, your {{2}} booking has been moved from {{3}} to {{4}}. See the updated booking using the button below.',
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
    // {{1}} customer name, {{2}} service, {{3}} amount; payment URL is a button
    example:
      'Hi {{1}}, your {{2}} booking is waiting for payment of {{3}}. Pay using the button below and your slot is confirmed.',
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
    // {{1}} customer name, {{2}} description, {{3}} amount; approval URL is a button
    example:
      'Hi {{1}}, your technician has found additional work needed: {{2}} ({{3}}). Approve or decline using the button below.',
  },

  job_completed: {
    name: 'job_completed',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when job status changes to COMPLETED',
    // {{1}} customer name; invoice URL is a button
    example:
      'Hi {{1}}, your job has been completed. View your invoice using the button below. Thank you for using our service!',
  },

  follow_up: {
    name: 'follow_up',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 24h after job completion to collect rating',
    // {{1}} customer name; rating URL is a button
    example:
      'Hi {{1}}, how did we do? Share your feedback using the button below. We appreciate your support!',
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
    // {{1}} customer name, {{2}} service, {{3}} quoted price; quote URL is a button
    example:
      'Hi {{1}}, your quote for {{2}} is ready: {{3}}. View and accept using the button below.',
  },

  // ─── Customer re-engagement ───────────────────────────────────────────────

  slot_available: {
    name: 'slot_available',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent when a slot opens in the area a customer requested (Notify Me)',
    // {{1}} customer name, {{2}} service, {{3}} available slot; booking URL is a button
    example:
      'Good news {{1}}! A slot for {{2}} has opened for {{3}} in your area. Tap the button below to book — slots go fast!',
  },

  no_technician_available: {
    name: 'no_technician_available',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when no technician can be matched — ask to reschedule or wait',
    // {{1}} customer name, {{2}} service, {{3}} original date; reschedule URL is a button
    example:
      'Hi {{1}}, we could not find a technician for your {{2}} on {{3}}. Please reschedule using the button below, or we will contact you when one is available.',
  },

  // ─── Technician — job matching & dispatch ────────────────────────────────

  job_offer: {
    name: 'job_offer',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent to a provider when a new matched lead is available to preview and accept',
    // {{1}} tech first name, {{2}} service, {{3}} area, {{4}} date/window; job URL is a button
    example:
      'Hi {{1}}, new lead: {{2}} in {{3}} on {{4}}. Preview using the button below. Accepting uses 1 credit and unlocks full customer details.',
  },

  technician_job_reminder: {
    name: 'technician_job_reminder',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to technician the evening before a confirmed job',
    // {{1}} tech first name, {{2}} service, {{3}} address, {{4}} time window; job URL is a button
    example:
      'Hi {{1}}, tomorrow: {{2}} job at {{3}} ({{4}}). View job details using the button below. See you on site!',
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
      'Hi {{1}}, we received your Plug A Pro provider application. Ref: {{2}}. We will review your details and update you here. Approval is not automatic.',
  },

  technician_welcome: {
    name: 'technician_welcome',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent on approval — includes app link. Used as template for >24h outreach',
    // {{1}} tech name, {{2}} app URL
    example:
      'Welcome to Plug A Pro, {{1}}! Your application is approved. Starter credits were awarded. Each customer-selected job you accept uses 1 credit. Worker Portal: {{2}}',
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
      'You have {{1}} Plug A Pro provider credit left. 1 credit = R50. Each customer-selected job you accept uses 1 credit. Top up now so you do not miss matched leads. {{2}} = {{3}} credits.',
  },

  wallet_zero_balance_lead: {
    name: 'wallet_zero_balance_lead',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a matched lead is available but the provider wallet has no credits',
    // {{1}} current credits, {{2}} minimum top-up amount
    example:
      'New matched lead available, but your wallet has {{1}} credits. 1 credit = R50. You need 1 credit only if the customer selects you and you accept that selected job. Top up {{2}}.',
  },

  wallet_payment_intent_created: {
    name: 'wallet_payment_intent_created',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after a provider creates a manual EFT wallet top-up intent',
    // {{1}} amount, {{2}} credits, {{3}} account name, {{4}} bank, {{5}} account number,
    // {{6}} branch code, {{7}} account type, {{8}} payment reference
    example:
      'Plug A Pro provider credits top-up created: {{1}} = {{2}} credits. EFT to {{3}}, {{4}}, account {{5}}, branch {{6}}, {{7}}. Use exact reference: {{8}}. Credits are issued after Plug-A-Pro confirms the payment.',
  },

  wallet_payment_credited: {
    name: 'wallet_payment_credited',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after admin reconciliation credits a provider wallet top-up',
    // {{1}} credits issued
    example:
      'Payment received. Your wallet has been credited with {{1}} Plug A Pro provider credits. 1 credit = R50. Each customer-selected job you accept uses 1 credit.',
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
      'Lead accepted and unlocked: {{1}}. 1 credit used. Customer: {{2}}. Phone: {{3}}. Address: {{4}}. Preferred time: {{5}}. Details: {{6}}',
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

  customer_match_found: {
    name: 'customer_match_found',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer when a provider has been matched to their job request',
    // body: {{1}} provider first name, {{2}} service label
    // button (url, index 0): {{1}} job request ID (appended to https://app.plugapro.co.za/requests/)
    example:
      'Good news! {{1}} is reviewing your {{2}} request and will send a quote shortly. Tap below to view your request.',
  },

  provider_invoice_send: {
    name: 'provider_invoice_send',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sends a post-job invoice to the customer on behalf of the provider',
    // body: {{1}} customer full name, {{2}} service label, {{3}} suburb, {{4}} city,
    //       {{5}} completion date (e.g. "4 May 2026"), {{6}} labour cost (e.g. "R 350.00"),
    //       {{7}} materials cost (e.g. "R 50.00"), {{8}} total amount (e.g. "R 400.00"),
    //       {{9}} job ref (last 8 chars of booking ID, uppercase), {{10}} provider full name
    example:
      'Hi {{1}}, here is your invoice for the {{2}} job at {{3}}, {{4}} completed on {{5}}.\n\nLabour: {{6}}\nMaterials: {{7}}\nTotal: {{8}}\n\nRef: {{9}}\nProvider: {{10}}\n\nThank you for choosing Plug A Pro!',
  },

  customer_provider_running_late: {
    name: 'customer_provider_running_late',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer when their provider reports they are running late',
    // body: {{1}} customer first name, {{2}} provider first name,
    //       {{3}} delay label (e.g. "a little late"), {{4}} service label
    example:
      'Hi {{1}}, {{2}} is running {{3}} for your {{4}} job. They\'re on their way — apologies for any inconvenience.',
  },

  customer_provider_en_route: {
    name: 'customer_provider_en_route',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer when their provider has shared location and is on the way',
    // body: {{1}} provider first name, {{2}} service label, {{3}} job suburb
    example:
      '{{1}} is on the way for your {{2}} job in {{3}}! They\'ll arrive shortly.',
  },

  customer_quote_ready: {
    name: 'customer_quote_ready',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer when a provider has submitted a quote for their job request',
    // body: {{1}} customer first name, {{2}} provider full name, {{3}} service label,
    //       {{4}} quote amount (e.g. "R 350.00"), {{5}} estimated hours (e.g. "2" or "TBD"),
    //       {{6}} valid until date (e.g. "5 May 2026"), {{7}} short description
    // button (quick_reply, index 0): payload quote_accept_<quoteId>
    // button (quick_reply, index 1): payload quote_decline_<quoteId>
    example:
      'Hi {{1}}, {{2}} has submitted a quote for your {{3}} job. Amount: {{4}}. Estimated time: {{5}} hours. Valid until: {{6}}. Details: {{7}}. Please accept or decline below.',
  },

  // ─── MVP1 pilot — accepted lock confirmations ────────────────────────────

  mvp1_accepted_lock_customer_confirmation: {
    name: 'mvp1_accepted_lock_customer_confirmation',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to the customer when their selected provider accepts the job (MVP1 pilot flow)',
    example:
      'Good news. Your selected Plug A Pro provider has accepted your request. Your request is now confirmed at MVP1 level. Next steps will be handled through the current pilot process.',
  },

  mvp1_accepted_lock_provider_confirmation: {
    name: 'mvp1_accepted_lock_provider_confirmation',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to the provider when they accept a customer-selected job (MVP1 pilot flow)',
    example:
      'You have accepted this Plug A Pro lead. Your credit has been applied. MVP1 flow is complete; follow the current pilot operating process for next steps.',
  },

} as const

export type TemplateName = keyof typeof TEMPLATES
