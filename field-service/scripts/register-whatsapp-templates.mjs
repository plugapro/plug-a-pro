#!/usr/bin/env node
// ─── WhatsApp template registration script ───────────────────────────────────
// Registers Plug A Pro message templates via Meta Graph API.
//
// As of 2026-04-08, all 21 production templates were registered against WABA
// 104200042667877 (Kgolaentle Holdings, +27 69 355 2447). This script covered
// Group B (12 templates); Group A (9 templates) were registered via inline
// script during the same session. All 21 are PENDING or APPROVED on that WABA.
//
// NOTE: the comment below about "9 already APPROVED" referred to a different
// registration assumption that was not accurate for WABA 104200042667877.
//
// Usage:
//   WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_WABA_ID=<waba_id> node scripts/register-whatsapp-templates.mjs
//   WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_WABA_ID=<waba_id> node scripts/register-whatsapp-templates.mjs --delete-rejected
//   node scripts/register-whatsapp-templates.mjs --audit-coverage
//   WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_WABA_ID=<waba_id> node scripts/register-whatsapp-templates.mjs --check-status
//
// --delete-rejected: deletes the 16 previously rejected en_US templates first

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WABA_ID = process.env.WHATSAPP_WABA_ID
const TOKEN   = process.env.WHATSAPP_ACCESS_TOKEN
const BASE    = 'https://graph.facebook.com/v21.0'
const DELETE_FIRST = process.argv.includes('--delete-rejected')
const AUDIT_COVERAGE = process.argv.includes('--audit-coverage')
const CHECK_STATUS = process.argv.includes('--check-status')

if (!AUDIT_COVERAGE && !CHECK_STATUS && (!WABA_ID || !TOKEN)) {
  console.error('Set WHATSAPP_WABA_ID and WHATSAPP_ACCESS_TOKEN')
  process.exit(1)
}

// ─── IDs of the 16 rejected en_US templates to delete ─────────────────────────
const REJECTED_IDS = [
  '1187552983294997', // technician_welcome
  '1249735256803517', // technician_payment_released
  '1157503333055221', // technician_job_reminder
  '946137075071588',  // job_offer
  '965954079199555',  // no_technician_available
  '823576083437906',  // slot_available
  '1380132070548730', // payment_received
  '1331665228794419', // payment_reminder
  '1552788629154867', // booking_rescheduled
  '1905579173293021', // technician_application_declined
  '3559037314248694', // technician_application_received
  '34428326390145589', // follow_up (en_US duplicate — en_ZA already approved)
  '2067785607453069', // job_completed (en_US duplicate — en_ZA already approved)
  '34987731390825358', // technician_arrived (en_US duplicate — en_ZA already approved)
  '2405827036512418', // technician_assigned
  '1644039893298368', // booking_reminder (en_US duplicate — en_ZA already approved)
]

// ─── 12 new templates (those without an approved en_ZA version) ───────────────
// Submitted as en_ZA to match the 9 existing APPROVED templates.
// Meta rule: variables cannot be the last token in a template body —
//   all bodies below end with static text (punctuation or a word after the last variable).
const TEMPLATES = [
  {
    name: 'booking_rescheduled',
    category: 'UTILITY',
    // {{1}} name, {{2}} service, {{3}} old slot, {{4}} new slot, {{5}} booking URL
    body: 'Hi {{1}}, your {{2}} booking has been moved from {{3}} to {{4}}. See updated booking: {{5}} — see you then!',
    examples: ['Thabo', 'Electrical Installation', 'Mon 14 Apr, 8am', 'Tue 15 Apr, 10am', 'https://app.plugapro.co.za/bookings/B001'],
  },
  {
    name: 'payment_reminder',
    category: 'UTILITY',
    // {{1}} name, {{2}} service, {{3}} amount, {{4}} payment URL
    body: 'Hi {{1}}, your {{2}} booking is waiting for payment of {{3}}. Pay here — {{4}} — and your slot is confirmed.',
    examples: ['Thabo', 'Plumbing Repair', 'R850.00', 'https://app.plugapro.co.za/pay/B001'],
  },
  {
    name: 'payment_received',
    category: 'UTILITY',
    // {{1}} name, {{2}} amount, {{3}} service, {{4}} booking ref
    body: 'Hi {{1}}, we received your payment of {{2}} for {{3}}. Booking confirmed — Ref: {{4}}. Thank you!',
    examples: ['Thabo', 'R850.00', 'Plumbing Repair', 'B001-2026'],
  },
  {
    name: 'technician_assigned',
    category: 'UTILITY',
    // {{1}} name, {{2}} technician name, {{3}} service, {{4}} date/window
    body: 'Hi {{1}}, great news! {{2}} has been assigned to your {{3}} on {{4}}. They will contact you through this app only.',
    examples: ['Thabo', 'Sipho M.', 'Electrical Installation', 'Mon 14 Apr, 8–10am'],
  },
  {
    name: 'slot_available',
    category: 'MARKETING',
    // {{1}} name, {{2}} service, {{3}} slot, {{4}} booking URL
    body: 'Good news {{1}}! A slot for {{2}} has opened for {{3}} in your area. Tap to book — {{4}} — slots go fast!',
    examples: ['Thabo', 'Plumbing Repair', 'Sat 19 Apr, 9–11am', 'https://app.plugapro.co.za/book'],
  },
  {
    name: 'no_technician_available',
    category: 'UTILITY',
    // {{1}} name, {{2}} service, {{3}} date, {{4}} reschedule URL
    // Body wording follows the currently APPROVED live Meta version ("match a provider")
    // and intentionally does not include a URL button — {{4}} is inline body text.
    body: 'Hi {{1}}, we could not match a provider for your {{2}} on {{3}}. Please reschedule here — {{4}} — or we will contact you when one is available.',
    examples: ['Thabo', 'Electrical Installation', 'Mon 14 Apr', 'https://app.plugapro.co.za/bookings/B001/reschedule'],
  },
  {
    name: 'job_offer',
    category: 'MARKETING',
    // {{1}} tech name, {{2}} service, {{3}} area, {{4}} date/window, {{5}} job URL
    body: 'Hi {{1}}, new job: {{2}} in {{3}} on {{4}}. Tap to accept — {{5}} — good luck!',
    examples: ['Sipho', 'Electrical Installation', 'Sandton, Gauteng', 'Mon 14 Apr, 8–10am', 'https://app.plugapro.co.za/jobs/J001'],
  },
  {
    name: 'provider_lead_offer',
    category: 'UTILITY',
    body: 'Hi {{1}}, a customer selected you for a {{2}} job in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.',
    examples: ['Lovemore', 'DIY & Assembly', 'Bromhof, Johannesburg', 'Flexible'],
    buttons: [
      {
        type: 'URL',
        text: 'View lead',
        url: 'https://app.plugapro.co.za/leads/access/{{1}}',
        example: ['demo-lead-access-token'],
      },
    ],
  },
  {
    name: 'quick_match_provider_lead_offer',
    category: 'MARKETING',
    body: 'Hi {{1}}, a new {{2}} lead is available in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.',
    examples: ['Lovemore', 'DIY & Assembly', 'Bromhof, Johannesburg', 'Flexible'],
    buttons: [
      {
        type: 'URL',
        text: 'View lead',
        url: 'https://app.plugapro.co.za/leads/access/{{1}}',
        example: ['demo-lead-access-token'],
      },
    ],
  },
  {
    // RFP/shortlist-phase invite — used when the customer has shortlisted this
    // provider but has not yet picked them. Body intentionally does NOT say
    // "selected you" (that copy belongs to provider_lead_offer which is sent
    // post-selection). Once Meta approves this template, switch
    // attemptProviderRfpWhatsAppNotification to use it instead of
    // provider_lead_offer.
    name: 'provider_rfp_lead_invite',
    category: 'UTILITY',
    body: 'Hi {{1}}, a customer is reviewing providers for a {{2}} job in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.',
    examples: ['Lovemore', 'DIY & Assembly', 'Bromhof, Johannesburg', 'Flexible'],
    buttons: [
      {
        type: 'URL',
        text: 'View lead',
        url: 'https://app.plugapro.co.za/leads/access/{{1}}',
        example: ['demo-lead-access-token'],
      },
    ],
  },
  {
    // Lead invite expired without a response. UTILITY so the notice reaches
    // providers outside the 24h window (the freeform interactive:lead_expired
    // send failed Meta Re-engagement for cold providers). No buttons.
    name: 'provider_lead_expired',
    category: 'UTILITY',
    // {{1}} provider first name, {{2}} service, {{3}} area
    body: "Hi {{1}}, the {{2}} lead in {{3}} expired before a response was received. No credits were used. We'll send you the next matching lead.",
    examples: ['Sipho', 'Plumbing', 'Bromhof, Johannesburg'],
  },
  {
    // Post-acceptance provider confirmation - customer contact released.
    // UTILITY so it reaches providers outside the 24h window. The signed job
    // handover suffix travels only in the URL button parameter, never in body text.
    name: 'provider_job_accepted_next_steps',
    category: 'UTILITY',
    // {{1}} provider first name, {{2}} service, {{3}} area
    body: 'Hi {{1}}, you accepted the {{2}} job in {{3}}. Customer contact is released — open your job page for details and next steps.',
    examples: ['Sipho', 'Plumbing', 'Bromhof, Johannesburg'],
    buttons: [
      {
        type: 'URL',
        text: 'View job',
        url: 'https://app.plugapro.co.za/provider/jobs/{{1}}',
        example: ['demo-job-request-id/handover?token=demo-token'],
      },
    ],
  },
  {
    name: 'technician_job_reminder',
    category: 'UTILITY',
    // {{1}} tech name, {{2}} service, {{3}} address, {{4}} time, {{5}} job URL
    body: 'Hi {{1}}, tomorrow: {{2}} job at {{3}} ({{4}}). View job details — {{5}} — see you on site!',
    examples: ['Sipho', 'Electrical Installation', '12 Oak Ave, Sandton', '8–10am', 'https://app.plugapro.co.za/jobs/J001'],
  },
  {
    name: 'technician_payment_released',
    category: 'UTILITY',
    // {{1}} tech name, {{2}} amount, {{3}} service, {{4}} ETA
    body: 'Hi {{1}}, your payment of {{2}} for the {{3}} job has been released. Funds arrive in {{4}} — great work!',
    examples: ['Sipho', 'R680.00', 'Electrical Installation', '1–2 business days'],
  },
  {
    name: 'technician_application_received',
    category: 'UTILITY',
    // {{1}} applicant name, {{2}} application ref
    body: 'Hi {{1}}, we received your application to join Plug a Pro. Ref: {{2}}. We review all applications within 24 hours and will update you here.',
    examples: ['Sipho Mokoena', 'APP-7F3A2B'],
  },
  {
    name: 'technician_welcome',
    category: 'MARKETING',
    // {{1}} tech name, {{2}} app download URL
    body: 'Welcome to Plug a Pro, {{1}}! Your application has been approved. Download the app — {{2}} — jobs are waiting!',
    examples: ['Sipho Mokoena', 'https://app.plugapro.co.za/download'],
  },
  {
    name: 'wallet_low_balance',
    category: 'MARKETING',
    body: 'You have {{1}} Plug A Pro provider credit left. 1 credit = R50. Each customer-selected job you accept uses 1 credit. Top up now so you do not miss matched leads. {{2}} = {{3}} credits.',
    examples: ['1', 'R100', '2'],
  },
  {
    name: 'wallet_zero_balance_lead',
    category: 'MARKETING',
    body: 'New matched lead available, but your wallet has {{1}} credits. 1 credit = R50. You need 1 credit only if the customer selects you and you accept that selected job. Top up {{2}} to continue.',
    examples: ['0', 'R100'],
  },
  {
    name: 'wallet_payment_intent_created',
    category: 'UTILITY',
    body: 'Plug A Pro provider credits top-up created: {{1}} = {{2}} credits. EFT to {{3}}, {{4}}, account {{5}}, branch {{6}}, {{7}}. Use exact reference: {{8}}. Credits are issued after Plug A Pro confirms the payment.',
    examples: ['R100.00', '2', 'Plug A Pro provider credits', 'Test Bank', '123456789', '250655', 'Business current account', 'PAP-1000-ABCD'],
  },
  {
    name: 'wallet_payment_credited',
    category: 'UTILITY',
    body: 'Payment received. Your wallet has been credited with {{1}} Plug A Pro provider credits. 1 credit = R50. Each customer-selected job you accept uses 1 credit.',
    examples: ['2'],
  },
  {
    name: 'wallet_payfast_topup_initiated',
    category: 'UTILITY',
    body: 'Your Plug A Pro top-up of {{1}} ({{2}} credits) has been initiated. Complete your payment on the checkout page. Credits will appear in your wallet once Payfast confirms payment.',
    examples: ['R100.00', '2'],
  },
  {
    name: 'wallet_payat_topup_initiated',
    category: 'UTILITY',
    body: 'Tap the button below to pay for your Plug A Pro wallet top-up. {{1}} = {{2}} credits. Credits will appear in your wallet once Pay@ confirms payment.',
    examples: ['R100.00', '2'],
    buttons: [
      {
        type: 'URL',
        text: 'Pay now',
        url: 'https://go.payat.co.za/{{1}}',
        example: ['pay/demo-reference'],
      },
    ],
  },
  {
    name: 'lead_unlock_provider',
    category: 'UTILITY',
    body: 'Lead accepted and unlocked: {{1}}. 1 credit used. Customer: {{2}}. Phone: {{3}}. Address: {{4}}. Preferred time: {{5}}. Details: {{6}}. Thanks.',
    examples: ['Plumbing', 'Zanele', '+27829876543', '12 Main Road, Sandton, Johannesburg', 'Thu 30 Apr, 10:00', 'Kitchen sink leak'],
  },
  {
    name: 'lead_unlock_customer_intro',
    category: 'MARKETING',
    body: 'Good news. We matched you with {{1}}. They may contact you shortly.',
    examples: ['Sipho Pro'],
  },
  {
    name: 'mvp1_accepted_lock_customer_confirmation',
    category: 'UTILITY',
    body: 'Good news. Your selected Plug A Pro provider has accepted your request. Your request is confirmed. We will keep you updated on the next step.',
    examples: [],
  },
  {
    name: 'mvp1_accepted_lock_provider_confirmation',
    category: 'UTILITY',
    body: 'Job accepted. Your credit has been applied and the customer details are now available in your job view.',
    examples: [],
  },
  {
    name: 'technician_application_declined',
    category: 'UTILITY',
    // {{1}} applicant name, {{2}} reason or "at this time"
    body: 'Hi {{1}}, thank you for applying to Plug a Pro. Unfortunately we are unable to onboard you {{2}}. You are welcome to apply again in the future.',
    examples: ['Sipho Mokoena', 'at this time'],
  },

  // ─── Provider Quality Uplift nudges (2026-06-17) ─────────────────────────
  // Drive providers to complete profile photo, evidence of work, certification
  // for high-risk skills, and remaining items. Pairs with
  // lib/provider-quality/ + /admin/quality. URL buttons are STATIC so the
  // template needs no per-send button parameter.
  {
    name: 'provider_profile_photo_nudge',
    category: 'UTILITY',
    // {{1}} provider first name
    body: 'Hi {{1}}, thanks for joining Plug A Pro. Please upload a clear profile photo so customers and our operations team can identify you properly. Tap the button below to update your profile - a complete profile gives you a better chance of being considered for work.',
    examples: ['Sipho'],
    buttons: [
      {
        type: 'URL',
        text: 'Update profile',
        url: 'https://app.plugapro.co.za/provider/profile',
      },
    ],
  },
  {
    name: 'provider_evidence_nudge',
    category: 'UTILITY',
    // {{1}} provider first name
    body: 'Hi {{1}}, before we send more customer requests we need to see evidence of your previous work. Please tap the button below to upload clear photos of completed jobs - this helps us understand the quality of your workmanship.',
    examples: ['Sipho'],
    buttons: [
      {
        type: 'URL',
        text: 'Upload evidence',
        url: 'https://app.plugapro.co.za/provider/profile/evidence',
      },
    ],
  },
  {
    name: 'provider_high_risk_cert_nudge',
    category: 'UTILITY',
    // {{1}} provider first name
    body: 'Hi {{1}}, you selected a service that requires extra proof because it can affect customer safety or property. Please tap the button below to upload your certification, qualification, or strong supporting evidence so we can confidently consider you for this type of work.',
    examples: ['Sipho'],
    buttons: [
      {
        type: 'URL',
        text: 'Upload certification',
        url: 'https://app.plugapro.co.za/provider/profile/evidence',
      },
    ],
  },
  // ─── Post-match customer notification (2026-06-18) ───────────────────────
  // Replaces the legacy interactive 24h-window-bound message that failed Meta
  // Re-engagement when the customer's last inbound was >24h old (JR-B Ishmael
  // incident). Submitted standalone via scripts/submit-post-match-customer-template.ts;
  // included here for audit coverage so --audit-coverage continues to pass.
  {
    name: 'post_match_customer_provider_accepted',
    category: 'UTILITY',
    // {{1}} customer first name, {{2}} provider first name, {{3}} service label
    body: 'Hi {{1}}, great news — {{2}} has accepted your {{3}} request and will contact you shortly to confirm the visit. Tap below to view the details.',
    examples: ['Stephanie', 'Sipho', 'Plumbing'],
    buttons: [
      {
        type: 'URL',
        text: 'View request',
        url: 'https://app.plugapro.co.za/requests/{{1}}',
        example: ['https://app.plugapro.co.za/requests/demo-job-request-id'],
      },
    ],
  },
  {
    name: 'provider_quality_multi_nudge',
    category: 'UTILITY',
    // {{1}} provider first name, {{2}} bullet list of missing items
    body: 'Hi {{1}}, we are improving provider quality before sending more customer requests. Please complete the following on your profile: {{2}} - tap the button below to update your profile. A complete profile helps us assess you properly and gives you a better chance of being considered for work.',
    examples: ['Sipho', '- Identity verification, - Profile photo'],
    buttons: [
      {
        type: 'URL',
        text: 'Update profile',
        url: 'https://app.plugapro.co.za/provider/profile',
      },
    ],
  },
  // ─── In-flight verification re-nudge (2026-06-21) ────────────────────────
  // Sent 24h after a provider stalls mid-verification. Each URL button takes
  // {{1}} = signed verification token suffix appended to /provider/verify/.
  {
    name: 'provider_verification_resume_consent',
    category: 'UTILITY',
    // {{1}} provider first name
    body: 'Hi {{1}}, your Plug A Pro identity verification is paused. Tap the button below to add your document details - takes about 60 seconds.',
    examples: ['Sipho'],
    buttons: [
      {
        type: 'URL',
        text: 'Resume verification',
        url: 'https://app.plugapro.co.za/provider/verify/{{1}}',
        example: ['demo-verification-token'],
      },
    ],
  },
  {
    name: 'provider_verification_resume_document',
    category: 'UTILITY',
    // {{1}} provider first name, {{2}} human-readable document label
    body: 'Hi {{1}}, your Plug A Pro identity verification just needs your {{2}} photo. Tap the button below to upload it.',
    examples: ['Sipho', 'SA ID'],
    buttons: [
      {
        type: 'URL',
        text: 'Upload document',
        url: 'https://app.plugapro.co.za/provider/verify/{{1}}',
        example: ['demo-verification-token'],
      },
    ],
  },
  {
    name: 'provider_verification_resume_selfie',
    category: 'UTILITY',
    // {{1}} provider first name
    body: 'Hi {{1}}, one quick selfie left to complete your Plug A Pro identity verification. Tap the button below to take it.',
    examples: ['Sipho'],
    buttons: [
      {
        type: 'URL',
        text: 'Take selfie',
        url: 'https://app.plugapro.co.za/provider/verify/{{1}}',
        example: ['demo-verification-token'],
      },
    ],
  },
  {
    name: 'provider_area_waitlist',
    category: 'UTILITY',
    // {{1}} applicant first name, {{2}} area label
    body: "Hi {{1}}, thanks for applying to Plug A Pro. We're not live in {{2}} yet - your application is saved and you're on the launch list. We'll message you the moment we start rolling out in your area. No need to re-apply.",
    examples: ['Sipho', 'Midrand'],
  },
  {
    name: 'please_confirm_with_provider',
    category: 'UTILITY',
    // {{1}} customer name, {{2}} provider name, {{3}} service, {{4}} request URL (inline body text)
    // Closes the customer-side gap when post-match notifications fail Re-engagement
    // outside the 24h window. URL is inline (no button) to match no_technician_available's shape.
    body: 'Hi {{1}}, {{2}} has accepted your {{3}} request and is waiting to hear back from you. Please reply here or message them with a preferred date and time — request: {{4}} — they will keep your slot open today.',
    examples: ['Ishmael', 'Vigilance Chauke', 'handyman', 'https://app.plugapro.co.za/requests/cmqf77w0o'],
  },
  {
    name: 'customer_abandoned_recovery',
    category: 'UTILITY',
    // {{1}} customer name (or "there"), {{2}} service category, {{3}} pickup URL
    // Recovers customers who abandoned a job_request flow mid-way (browse_categories,
    // addr_confirm, collect_issue_description). UTILITY so it can fire outside the
    // 24h customer-service window. URL is inline body text, no button.
    body: "Hi {{1}}, you started a {{2}} request with us earlier and didn't finish. Tap to pick it up here — {{3}} — your details are saved.",
    examples: ['Andries', 'garden', 'https://app.plugapro.co.za/'],
  },
]

// Templates that are intentionally managed outside this script's creation
// batch (already registered or registered through separate rollout scripts).
// Keep this list in sync with actual WABA registration status.
const MANAGED_EXISTING_TEMPLATE_NAMES = [
  'booking_cancelled',
  'booking_confirmation',
  'booking_reminder',
  'customer_match_found',
  'customer_provider_en_route',
  'customer_provider_running_late',
  'customer_quote_ready',
  'extra_work_approval',
  'follow_up',
  'job_completed',
  'otp_login',
  'provider_invoice_send',
  'quote_ready',
  'technician_arrived',
  'technician_on_the_way',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function deleteTemplate(id) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  return res.json()
}

async function registerTemplate(tpl) {
  const components = [{
    type: 'BODY',
    text: tpl.body,
  }]
  if (tpl.examples?.length) {
    components[0].example = { body_text: [tpl.examples] }
  }

  if (tpl.buttons?.length) {
    components.push({
      type: 'BUTTONS',
      buttons: tpl.buttons,
    })
  }

  const res = await fetch(`${BASE}/${WABA_ID}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: tpl.name,
      language: 'en_ZA',
      category: tpl.category,
      components,
    }),
  })
  return res.json()
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function extractTemplateNamesFromRegistry() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const registryPath = resolve(scriptDir, '../lib/messaging-templates.ts')
  const source = readFileSync(registryPath, 'utf8')
  const matches = source.matchAll(/name:\s*'([^']+)'/g)
  const names = new Set()
  for (const match of matches) {
    names.add(match[1])
  }
  return [...names].sort()
}

function auditCoverage() {
  const registryNames = extractTemplateNamesFromRegistry()
  const registrationBatchNames = new Set(TEMPLATES.map((tpl) => tpl.name))
  const managedExisting = new Set(MANAGED_EXISTING_TEMPLATE_NAMES)
  const coveredNames = new Set([
    ...registrationBatchNames,
    ...managedExisting,
  ])
  const missingFromRegistrationScript = registryNames.filter((name) => !coveredNames.has(name))

  console.log(`Templates declared in lib/messaging-templates.ts: ${registryNames.length}`)
  console.log(`Templates currently in scripts/register-whatsapp-templates.mjs batch: ${registrationBatchNames.size}`)
  console.log(`Templates covered by managed-existing allowlist: ${managedExisting.size}`)

  if (missingFromRegistrationScript.length === 0) {
    console.log('Coverage OK: registration batch includes all template names.')
    return 0
  }

  console.log('\nTemplates missing from registration batch:')
  for (const name of missingFromRegistrationScript) console.log(`- ${name}`)
  console.log('\nUpdate this script before production registration to avoid template drift.')
  return 2
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (CHECK_STATUS) {
    if (!WABA_ID || !TOKEN) {
      console.error('Set WHATSAPP_WABA_ID and WHATSAPP_ACCESS_TOKEN')
      process.exit(1)
    }
    const walletTemplateNames = TEMPLATES
      .filter((t) => t.name.startsWith('wallet_'))
      .map((t) => t.name)

    console.log(`\nChecking approval status for ${walletTemplateNames.length} wallet templates...\n`)

    for (const name of walletTemplateNames) {
      let templates
      try {
        const url = `${BASE}/${WABA_ID}/message_templates?name=${name}&fields=name,status,category,language`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
        const json = await res.json()
        if (!res.ok || json.error) {
          console.log(`  ${name.padEnd(36)} ❌  API ERROR ${res.status}: ${json.error?.message ?? 'unknown'}`)
          await sleep(150)
          continue
        }
        templates = json.data ?? []
      } catch (err) {
        console.log(`  ${name.padEnd(36)} ❌  NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`)
        await sleep(150)
        continue
      }

      if (templates.length === 0) {
        console.log(`  ${name.padEnd(36)} ⚠️  NOT FOUND on WABA`)
      } else {
        for (const tpl of templates) {
          const statusIcon = tpl.status === 'APPROVED' ? '✅' : tpl.status === 'PENDING' ? '⏳' : '❌'
          console.log(`  ${name.padEnd(36)} ${statusIcon}  ${tpl.status} (${tpl.language})`)
        }
      }
      await sleep(150)
    }
    console.log('\nNote: PENDING templates are awaiting Meta review (24–72h).')
    console.log('APPROVED templates send immediately. REJECTED templates need to be re-submitted.')
    return
  }

  if (AUDIT_COVERAGE) {
    process.exitCode = auditCoverage()
    return
  }

  // ── Step 1: Delete rejected templates ──────────────────────────────────────
  if (DELETE_FIRST) {
    console.log(`\nDeleting ${REJECTED_IDS.length} rejected en_US templates...\n`)
    let deleted = 0, deleteFailed = 0
    for (const id of REJECTED_IDS) {
      process.stdout.write(`  id=${id.padEnd(20)} `)
      const data = await deleteTemplate(id)
      if (data.success === true || data.deleted === true) {
        console.log('🗑  deleted')
        deleted++
      } else if (data.error?.code === 100 && data.error?.message?.includes('does not exist')) {
        console.log('⚪  not found (already deleted)')
        deleted++
      } else {
        console.log(`❌  ${data.error?.message ?? JSON.stringify(data)}`)
        deleteFailed++
      }
      await sleep(200)
    }
    console.log(`\n  Deleted: ${deleted}  Failed: ${deleteFailed}\n`)
  }

  // ── Step 2: Register new templates ─────────────────────────────────────────
  console.log(`\nRegistering ${TEMPLATES.length} new templates for WABA ${WABA_ID}\n`)
  const ok = [], skipped = [], failed = []

  for (const tpl of TEMPLATES) {
    process.stdout.write(`  ${tpl.name.padEnd(38)} `)
    const data = await registerTemplate(tpl)

    if (data.id) {
      console.log(`✅  id=${data.id}  status=${data.status ?? 'PENDING'}`)
      ok.push(tpl.name)
    } else if (JSON.stringify(data).toLowerCase().includes('already exist')) {
      console.log(`⏭  already exists`)
      skipped.push(tpl.name)
    } else {
      console.log(`❌  ${data.error?.message ?? JSON.stringify(data)}`)
      failed.push({ name: tpl.name, error: data.error?.message })
    }
    await sleep(200)
  }

  console.log(`\n──────────────────────────────────────────`)
  console.log(`✅  Registered : ${ok.length}`)
  console.log(`⏭   Skipped    : ${skipped.length}  (already existed)`)
  console.log(`❌  Failed     : ${failed.length}`)
  if (failed.length) failed.forEach(f => console.log(`    ${f.name}: ${f.error}`))
  console.log(`\nNote: New templates start in PENDING status.`)
  console.log(`Meta review takes 24–72 hours. Check status in WhatsApp Manager.`)
}

main().catch(e => { console.error(e); process.exit(1) })
