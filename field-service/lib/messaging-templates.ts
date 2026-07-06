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
//   UTILITY    - transactional, post-purchase, service updates
//   MARKETING  - re-engagement, promotions (higher cost, lower delivery in DND)
//
// Variable notation: {{1}}, {{2}} … - positional, replaced at send time.

export const TEMPLATES = {

  // ─── Authentication ───────────────────────────────────────────────────────

  otp_login: {
    name: 'otp_login',
    language: 'en_ZA',
    category: 'AUTHENTICATION',
    description: 'Sign-in OTP delivery via WhatsApp (replaces Supabase SMS).',
    // {{1}} OTP code (6 digits)
    example:
      'Your Plug A Pro verification code is {{1}}. It expires in 5 minutes. Do not share it.',
  },

  // Sent immediately after `otp_login`. Signal metadata may still tag
  // suspicious sends (send-velocity >=3/h, IP-diversity >=2 in 30m or any
  // NEW/ACKNOWLEDGED security_event for this phone in the last 14 days), but
  // the report affordance is always delivered while `security.otp.report` is on.
  // Body is parameterless;
  // the single quick-reply button carries a per-challenge report token in its
  // payload variable. Inbound handler in lib/whatsapp-bot.ts already parses
  // payloads of shape `otp_report_<token>`.
  otp_security_check: {
    name: 'otp_security_check',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Always-on security check after OTP send; one quick-reply button to report unrequested OTP.',
    // No body parameters. Quick-reply button payload param: {{1}} = report token.
    example:
      "Plug A Pro security check.\n\nWe just sent you a sign-in code. If you didn't request this, tap below to block it - your account stays safe.",
  },

  // ─── Customer journey - booking lifecycle ─────────────────────────────────

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

  // ─── Customer journey - payment ───────────────────────────────────────────

  payment_reminder: {
    name: 'payment_reminder',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 2h after PENDING_PAYMENT status - resends payment link',
    // {{1}} customer name, {{2}} service, {{3}} amount; payment URL is a button
    example:
      'Hi {{1}}, your {{2}} booking is waiting for payment of {{3}}. Pay using the button below and your slot is confirmed.',
  },

  payment_received: {
    name: 'payment_received',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when payment clears (Peach webhook) - explicit confirmation',
    // {{1}} customer name, {{2}} amount, {{3}} service, {{4}} booking ref
    example:
      'Hi {{1}}, we received your payment of {{2}} for {{3}}. Booking confirmed - Ref: {{4}}. Thank you!',
  },

  // ─── Customer journey - technician dispatch ───────────────────────────────

  technician_assigned: {
    name: 'technician_assigned',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when a specific technician is assigned/confirmed for a booking',
    // {{1}} customer name, {{2}} technician first name, {{3}} service, {{4}} date/window
    // Body reworded 2026-07-06 (positioning audit): avoid "assigned" employer framing.
    // Pending re-submission at Meta - live sends use the previously approved body until then.
    example:
      'Hi {{1}}, great news! Independent provider {{2}} is confirmed for your {{3}} on {{4}}. They will contact you through this app only.',
  },

  technician_on_the_way: {
    name: 'technician_on_the_way',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when technician status changes to EN_ROUTE',
    // {{1}} customer name, {{2}} technician name, {{3}} ETA
    // Body registered with Meta 2026-04-08 (original body was rejected - leading param).
    // Body reworded 2026-07-06 (positioning audit): "your Plug A Pro technician" implied
    // an employment relationship. Pending re-submission at Meta - live sends use the
    // previously approved body ("your Plug A Pro technician {{2}}...") until then.
    example:
      'Hi {{1}}, your service provider {{2}} is heading your way now. Expected arrival in {{3}} - see you soon!',
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
    // Body reworded 2026-07-06 (positioning audit): "your technician" -> "your service
    // provider". Pending re-submission at Meta - live sends use the approved body until then.
    example:
      'Hi {{1}}, your service provider has identified additional work needed: {{2}} ({{3}}). Approve or decline using the button below.',
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

  // ─── Customer journey - quote flow ────────────────────────────────────────

  quote_ready: {
    name: 'quote_ready',
    language: 'en_ZA',
    // Meta classified this as MARKETING (not UTILITY) - category must match or policy gate is wrong.
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
      'Good news {{1}}! A slot for {{2}} has opened for {{3}} in your area. Tap the button below to book - slots go fast!',
  },

  no_technician_available: {
    name: 'no_technician_available',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when no provider can be matched - ask to reschedule or wait',
    // {{1}} customer name, {{2}} service, {{3}} original date, {{4}} reschedule URL (inline body text, NOT a button)
    example:
      'Hi {{1}}, we could not match a provider for your {{2}} on {{3}}. Please reschedule here — {{4}} — or we will contact you when one is available.',
  },

  please_confirm_with_provider: {
    name: 'please_confirm_with_provider',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Sent after a provider has accepted a customer match, to prompt the customer to confirm a date/time with them. Used when the platform-side post-match notice may not have reached the customer (e.g. 24h-window failure) or when the customer has not engaged after the assignment notice. Inline reschedule URL in body, no button.',
    // {{1}} customer name, {{2}} provider name, {{3}} service, {{4}} request URL (inline body text)
    example:
      'Hi {{1}}, {{2}} has accepted your {{3}} request and is waiting to hear back from you. Please reply here or message them with a preferred date and time — request: {{4}} — they will keep your slot open today.',
  },

  customer_abandoned_recovery: {
    name: 'customer_abandoned_recovery',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Sent to customers who started a service request and abandoned mid-flow (e.g. browse_categories, addr_confirm, collect_issue_description) so they can pick up where they left off. UTILITY so it works outside the 24h window. Inline pickup URL in body, no button.',
    // {{1}} customer name (or "there"), {{2}} service category, {{3}} pickup URL (inline body text)
    example:
      'Hi {{1}}, you started a {{2}} request with us earlier and didn\'t finish. Tap to pick it up here — {{3}} — your details are saved.',
  },

  // ─── Technician - job matching & dispatch ────────────────────────────────

  job_offer: {
    name: 'job_offer',
    language: 'en_ZA',
    category: 'MARKETING',
    description: 'Sent to a provider when a new matched lead is available to preview and accept',
    // {{1}} tech first name, {{2}} service, {{3}} area, {{4}} date/window;
    // signed lead URL is a template URL button parameter, never a body variable.
    example:
      'Hi {{1}}, new job: {{2}} in {{3}} on {{4}}. Tap the button below to view the lead.',
  },

  provider_lead_offer: {
    name: 'provider_lead_offer',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Safe provider lead notification with signed lead URL only in a template URL button',
    // {{1}} provider first name, {{2}} service, {{3}} area, {{4}} date/window;
    // button (url, index 0): {{1}} signed lead access token suffix appended to /leads/access/
    example:
      'Hi {{1}}, a customer selected you for a {{2}} job in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.',
  },

  quick_match_provider_lead_offer: {
    name: 'quick_match_provider_lead_offer',
    language: 'en_ZA',
    // Meta approved this as MARKETING. The provider lead sender is a direct
    // dispatch path and does not use the generic customer canSend() gate.
    category: 'MARKETING',
    description: 'Quick Match provider lead notification with signed lead URL only in a template URL button',
    // {{1}} provider first name, {{2}} service, {{3}} area, {{4}} date/window;
    // button (url, index 0): {{1}} signed lead access token suffix appended to /leads/access/
    example:
      'Hi {{1}}, a new {{2}} lead is available in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.',
  },

  provider_rfp_lead_invite: {
    name: 'provider_rfp_lead_invite',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'RFP/shortlist invitation - sent before the customer selects a provider; copy does not claim "selected you"',
    // {{1}} provider first name, {{2}} service, {{3}} area, {{4}} date/window;
    // button (url, index 0): {{1}} signed lead access token suffix appended to /leads/access/
    example:
      'Hi {{1}}, a customer is reviewing providers for a {{2}} job in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.',
  },

  provider_lead_expired: {
    name: 'provider_lead_expired',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Sent when a provider lead invite expires without a response - no credits used, next matching lead promised. UTILITY so it works outside the 24h window. No buttons.',
    // {{1}} provider first name, {{2}} service, {{3}} area
    example:
      "Hi {{1}}, the {{2}} lead in {{3}} expired before a response was received. No credits were used. We'll send you the next matching lead.",
  },

  provider_job_accepted_next_steps: {
    name: 'provider_job_accepted_next_steps',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Post-acceptance provider confirmation - customer contact released, signed job page link in a template URL button. UTILITY so it works outside the 24h window.',
    // {{1}} provider first name, {{2}} service, {{3}} area;
    // button (url, index 0): {{1}} signed job handover suffix appended to /provider/jobs/
    example:
      'Hi {{1}}, you accepted the {{2}} job in {{3}}. Customer contact is released — open your job page for details and next steps.',
  },

  provider_kyc_nudge: {
    name: 'provider_kyc_nudge',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'KYC drive nudge for existing providers - identity verification requirement notice with signed verification link in a template URL button',
    // {{1}} provider first name, {{2}} completion deadline (e.g. "30 June 2026");
    // button (url, index 0): {{1}} signed verification token suffix appended to /provider/verify/
    example:
      'Hi {{1}}, Plug A Pro now requires identity verification for all providers. Verify by {{2}} to keep receiving job leads - it takes about 5 minutes. Tap the button below to start.',
  },

  // ─── Provider Quality Uplift nudges ──────────────────────────────────────
  // Templates submitted to Meta in support of the Quality Uplift admin flow
  // (lib/provider-quality/). Until each one is APPROVED at Meta, sends will
  // fail outside the 24h re-engagement window — the admin dry-run preview
  // works regardless because it never hits the WhatsApp API.
  provider_profile_photo_nudge: {
    name: 'provider_profile_photo_nudge',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Quality Uplift nudge - asks provider to upload a clear profile photo. CTA URL button to the profile dashboard.',
    // {{1}} provider first name; button (url, index 0): path suffix to /provider/profile
    example:
      'Hi {{1}}, please upload a clear profile photo so customers and our operations team can identify you. Tap the button below to update your profile - a complete profile gives you a better chance of being considered for work.',
  },

  provider_evidence_nudge: {
    name: 'provider_evidence_nudge',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Quality Uplift nudge - asks provider to upload evidence of previous work. CTA URL button to the evidence upload screen.',
    // {{1}} provider first name; button (url, index 0): path suffix to /provider/profile/evidence
    example:
      'Hi {{1}}, before we send more customer requests, we need to see evidence of your previous work. Please tap the button below to upload clear photos of completed jobs - this helps us understand the quality of your workmanship.',
  },

  provider_high_risk_cert_nudge: {
    name: 'provider_high_risk_cert_nudge',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Quality Uplift nudge - asks provider to upload certification/qualification or strong supporting evidence for a high-risk or regulated service. CTA URL button to the evidence upload screen.',
    // {{1}} provider first name; button (url, index 0): path suffix to /provider/profile/evidence
    example:
      'Hi {{1}}, you selected a service that requires extra proof because it can affect customer safety or property. Please tap the button below to upload your certification, qualification, or strong supporting evidence.',
  },

  provider_quality_multi_nudge: {
    name: 'provider_quality_multi_nudge',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Quality Uplift nudge - asks provider to complete multiple missing profile items (combination of KYC, photo, evidence, cert). CTA URL button to the profile dashboard. {{2}} carries the bullet list of missing items.',
    // {{1}} provider first name, {{2}} bullet list of missing items (one per line, prefixed with "- ");
    // button (url, index 0): path suffix to /provider/profile
    example:
      'Hi {{1}}, please complete the following on your profile:\n{{2}}\nA complete profile helps us assess you properly and gives you a better chance of being considered for work.',
  },

  // ─── In-flight identity-verification re-nudge (2026-06-21) ──────────────
  // Sent 24h after a provider stalls mid-verification (CONSENTED, AWAITING_*).
  // Tighter than the 7-day Quality Uplift spacing because these providers
  // already showed intent and the verification flow has known mid-flow drops
  // (Wave 1 of admin.quality.uplift: 22 read / 3 started / 0 completed).
  // All three URL buttons take {{1}} = signed verification token suffix
  // appended to /provider/verify/. Sender mints a fresh token via
  // issueProviderIdentityVerificationLink (fail_safe ON resumes the row).
  provider_verification_resume_consent: {
    name: 'provider_verification_resume_consent',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'In-flight re-nudge for providers in CONSENTED / AWAITING_IDENTIFIER / RETRY_REQUIRED. Asks them to finish entering identity details.',
    // {{1}} provider first name; button (url, index 0): {{1}} signed verification token suffix
    example:
      'Hi {{1}}, your Plug A Pro identity verification is paused. Tap the button below to add your document details — takes about 60 seconds.',
  },

  provider_verification_resume_document: {
    name: 'provider_verification_resume_document',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'In-flight re-nudge for providers in AWAITING_DOCUMENT. Asks them to upload the specific document the identity basis requires.',
    // {{1}} provider first name, {{2}} human-readable document label (e.g. "SA ID");
    // button (url, index 0): {{1}} signed verification token suffix
    example:
      'Hi {{1}}, your Plug A Pro identity verification just needs your {{2}} photo. Tap the button below to upload it.',
  },

  provider_verification_resume_selfie: {
    name: 'provider_verification_resume_selfie',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'In-flight re-nudge for providers in AWAITING_SELFIE. Asks them to take the final selfie to complete verification.',
    // {{1}} provider first name; button (url, index 0): {{1}} signed verification token suffix
    example:
      'Hi {{1}}, one quick selfie left to complete your Plug A Pro identity verification. Tap the button below to take it.',
  },

  // ─── Application triage sweep (2026-07-01) ───────────────────────────────
  provider_area_waitlist: {
    name: 'provider_area_waitlist',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Sent to out-of-pilot applicants during the application triage sweep. Parks them on the launch waitlist; prevents re-applications.',
    // {{1}} applicant first name, {{2}} area label (e.g. "Midrand", "the Western Cape")
    example:
      "Hi {{1}}, thanks for applying to Plug A Pro. We're not live in {{2}} yet — your application is saved and you're on the launch list. We'll message you the moment we start rolling out in your area. No need to re-apply.",
  },

  technician_job_reminder: {
    name: 'technician_job_reminder',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to technician the evening before a confirmed job',
    // {{1}} tech first name, {{2}} service, {{3}} address, {{4}} time window;
    // job URL is a template URL button parameter, never a body variable.
    example:
      'Hi {{1}}, {{4}}: {{2}} job at {{3}}.',
  },

  technician_payment_released: {
    name: 'technician_payment_released',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent when payment for a completed job is released to the technician',
    // {{1}} tech first name, {{2}} amount, {{3}} service, {{4}} expected arrival (e.g. "1–2 business days")
    example:
      'Hi {{1}}, your payment of {{2}} for the {{3}} job has been released. Funds arrive in {{4}} - great work!',
  },

  // ─── Technician - onboarding ──────────────────────────────────────────────

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
    description: 'Sent on approval - includes app link. Used as template for >24h outreach',
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

  provider_application_id_needed: {
    name: 'provider_application_id_needed',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Nudge a submitted applicant who is missing their ID number. UTILITY so it reaches cold applicants outside the 24h window (registered 2026-07-05).',
    // {{1}} applicant first name
    example:
      "Hi {{1}}, thanks for applying to join Plug A Pro. To complete your application we still need your South African ID number. Please reply to this chat with your 13-digit ID number and we'll continue your review.",
  },

  provider_application_more_info: {
    name: 'provider_application_more_info',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Approved-template replacement for the freeform interactive:provider_more_info_required send, so request-more-info reaches cold applicants (registered 2026-07-05).',
    // {{1}} applicant first name, {{2}} what is needed (reason text)
    example:
      "Hi {{1}}, we're reviewing your application to join Plug A Pro and need a bit more information: {{2}}. Please reply to this chat with the details and we'll continue your review.",
  },

  // ─── Provider wallet and paid lead lifecycle ─────────────────────────────

  wallet_low_balance: {
    name: 'wallet_low_balance',
    language: 'en_ZA',
    // Meta classified this as MARKETING; keep local category aligned with the
    // WABA template so registration and policy checks do not drift.
    category: 'MARKETING',
    description: 'Sent when a provider wallet reaches one remaining credit',
    // {{1}} remaining credits, {{2}} top-up amount, {{3}} credits issued
    example:
      'You have {{1}} Plug A Pro provider credit left. 1 credit = R50. Each customer-selected job you accept uses 1 credit. Top up now so you do not miss matched leads. {{2}} = {{3}} credits.',
  },

  wallet_zero_balance_lead: {
    name: 'wallet_zero_balance_lead',
    language: 'en_ZA',
    // Meta classified this as MARKETING; keep local category aligned with the
    // WABA template so registration and policy checks do not drift.
    category: 'MARKETING',
    description: 'Sent when a matched lead is available but the provider wallet has no credits',
    // {{1}} current credits, {{2}} minimum top-up amount
    example:
      'New matched lead available, but your wallet has {{1}} credits. 1 credit = R50. You need 1 credit only if the customer selects you and you accept that selected job. Top up {{2}} to continue.',
  },

  wallet_payment_intent_created: {
    name: 'wallet_payment_intent_created',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after a provider creates a manual EFT wallet top-up intent',
    // {{1}} amount, {{2}} credits, {{3}} account name, {{4}} bank, {{5}} account number,
    // {{6}} branch code, {{7}} account type, {{8}} payment reference
    example:
      'Plug A Pro provider credits top-up created: {{1}} = {{2}} credits. EFT to {{3}}, {{4}}, account {{5}}, branch {{6}}, {{7}}. Use exact reference: {{8}}. Credits are issued after Plug A Pro confirms the payment.',
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

  wallet_payat_topup_initiated: {
    name: 'wallet_payat_topup_initiated',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent after a provider initiates a Pay@ wallet top-up',
    // body: {{1}} amount formatted, {{2}} credits to issue
    // button (url, index 0): Pay@ payment URL
    // NOTE: WhatsApp template approval required before live sends succeed.
    example:
      'Tap the button below to pay for your Plug A Pro wallet top-up. {{1}} = {{2}} credits. Credits will appear in your wallet once Pay@ confirms payment.',
  },

  lead_unlock_provider: {
    name: 'lead_unlock_provider',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a provider after paid credits unlock customer lead details',
    // {{1}} category, {{2}} customer name, {{3}} customer phone, {{4}} address,
    // {{5}} preferred time, {{6}} details
    example:
      'Lead accepted and unlocked: {{1}}. 1 credit used. Customer: {{2}}. Phone: {{3}}. Address: {{4}}. Preferred time: {{5}}. Details: {{6}}. Thanks.',
  },

  lead_unlock_customer_intro: {
    name: 'lead_unlock_customer_intro',
    language: 'en_ZA',
    // Meta classified this as MARKETING; keep local category aligned with the
    // WABA template so registration and policy checks do not drift.
    category: 'MARKETING',
    description: 'Sent to a customer after a provider unlocks their lead details',
    // {{1}} provider name
    example:
      'Good news - we matched you with {{1}}. They may contact you shortly.',
  },

  customer_match_found: {
    name: 'customer_match_found',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer when a provider has been matched to their job request',
    // body: {{1}} customer first name, {{2}} service label, {{3}} provider first name
    // button (url, index 0): {{1}} job request ID (appended to https://app.plugapro.co.za/requests/)
    // NOTE: the version APPROVED at Meta (template id 1508767677372957) says
    // "They're highly rated and ready to assist you." - reworded 2026-07-06
    // (positioning audit): generic "highly rated" puffery asserted regardless of
    // actual rating data. Param count unchanged; live sends use the approved body
    // until the new body is re-submitted. Sending a different param count fails
    // Meta 132000 at send time.
    example:
      "Hi {{1}} 👋\n\nGreat news! We've matched your {{2}} request with {{3}}.\n\nYou can review their details and quote before approving anything.\n\nTrack your request and approve quotes here 👇",
  },

  // Sent to a customer when a provider has ACCEPTED their job request (post-match
  // handover). Replaces an interactive 24h-window-bound message that previously
  // failed Re-engagement when the customer's last inbound was >24h old.
  // Until APPROVED at Meta, sends will throw [TEMPLATE_NOT_APPROVED]; the
  // post-match sender catches that and falls through to `customer_match_found`
  // and then to the rich CTA-URL inside-window path.
  post_match_customer_provider_accepted: {
    name: 'post_match_customer_provider_accepted',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer when a provider has accepted their job request (post-match handover).',
    // body: {{1}} customer first name, {{2}} provider first name, {{3}} service label
    // button (url, index 0): {{1}} job request ID (appended to https://app.plugapro.co.za/requests/)
    example:
      'Hi {{1}}, great news — {{2}} has accepted your {{3}} request and will contact you shortly to confirm the visit. Tap below to view the details.',
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
      'Hi {{1}}, {{2}} is running {{3}} for your {{4}} job. They\'re on their way - apologies for any inconvenience.',
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

  // ─── Pilot - post-job completion check & review nudge ────────────────────

  post_job_completion_check: {
    name: 'post_job_completion_check',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a customer ~2 days after the job window to confirm completion (cash pilot flow). Requires Meta approval with 2 Quick Reply buttons.',
    // body: {{1}} customer first name, {{2}} provider first name, {{3}} service label
    // button 0 (quick_reply): "Yes, all done" → payload completion_yes_<matchId>
    // button 1 (quick_reply): "Not quite"     → payload completion_no_<matchId>
    example:
      'Hi {{1}}, did {{2}} complete your {{3}} job as expected?\n\nTap below to let us know - it takes 5 seconds.',
  },

  post_job_provider_review_nudge: {
    name: 'post_job_provider_review_nudge',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to a provider when their customer confirmed job completion. Nudges them to leave a review with a URL button. Requires Meta approval.',
    // body: {{1}} provider first name, {{2}} customer first name, {{3}} service label
    // button 0 (url): review link suffix (token) - base URL must be registered in Meta template
    example:
      'Hi {{1}}, {{2}} confirmed your {{3}} job is complete. \u2b50 Reviews on Plug A Pro boost your profile score and the leads you receive. Tap below to rate the job - it takes 30 seconds.',
  },

  // ─── MVP1 pilot - accepted lock confirmations ────────────────────────────

  mvp1_accepted_lock_customer_confirmation: {
    name: 'mvp1_accepted_lock_customer_confirmation',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to the customer when their selected provider accepts the job (MVP1 pilot flow)',
    example:
      'Good news. Your selected Plug A Pro provider has accepted your request. Your request is confirmed. We will keep you updated on the next step.',
  },

  mvp1_accepted_lock_provider_confirmation: {
    name: 'mvp1_accepted_lock_provider_confirmation',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent to the provider when they accept a customer-selected job (MVP1 pilot flow)',
    example:
      'Job accepted. Your credit has been applied and the customer details are now available in your job view.',
  },

  // ─── Provider onboarding recovery templates ───────────────────────────────

  provider_recovery_evidence: {
    name: 'provider_recovery_evidence',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Outside-session recovery for providers stuck at evidence upload.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      "Hi {{1}}, this is Plug A Pro. You're almost done with your provider registration. We still need your work photo or proof of service so we can finish reviewing your profile. Please reply here when you're ready and we'll help you complete it.",
  },

  provider_recovery_started_blocked: {
    name: 'provider_recovery_started_blocked',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Outside-session recovery for providers who started registration and got blocked.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      "Hi {{1}}, this is Plug A Pro. I can see you started your provider registration but didn't finish it. Please reply with your full name, the service you offer, and the area where you work, and we'll help you complete it.",
  },

  provider_recovery_no_name: {
    name: 'provider_recovery_no_name',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Outside-session recovery for providers who tapped register without entering a name.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      "Hi {{1}}, this is Plug A Pro. I noticed you tapped register but didn't complete your name. To continue your provider registration, please reply with your full name.",
  },

  provider_recovery_welcome_idle: {
    name: 'provider_recovery_welcome_idle',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Outside-session recovery for idle provider prospects at welcome.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      'Hi {{1}}, this is Plug A Pro. We help service providers get matched with job requests. To register as a provider, please reply REGISTER and we will help you complete your profile.',
  },

  provider_recovery_flow_conflict: {
    name: 'provider_recovery_flow_conflict',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Outside-session recovery for WhatsApp sessions that entered the wrong flow.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      'Hi {{1}}, this is Plug A Pro. It looks like your WhatsApp session may have gone into the wrong flow. Please reply 1 to register as a provider, or 2 to request a service from a provider.',
  },

  // ─── Provider registration friction-fix templates (2026-06-04) ─────────────

  provider_registration_continue: {
    name: 'provider_registration_continue',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent ~5 min before Conversation.expiresAt to rescue mid-flow registration sessions. The quick-reply button payload "reg_start" triggers the existing registration resume path.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      "Hi {{1}}, you're almost done with your Plug A Pro provider application. Your progress is saved — tap below to pick up where you left off before the session times out.",
  },

  provider_evidence_followup: {
    name: 'provider_evidence_followup',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 24h after PENDING ProviderApplication submission, inviting the provider to add a work photo. UTILITY because it relates to the in-progress application.',
    // {{1}} provider first name
    example:
      'Hi {{1}}, want to strengthen your Plug A Pro profile? Tap below to add one work photo. Skip is fine — we already have your application.',
  },

} as const

export type TemplateName = keyof typeof TEMPLATES
