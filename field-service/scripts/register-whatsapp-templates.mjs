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

if (!AUDIT_COVERAGE && (!WABA_ID || !TOKEN)) {
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
    body: 'Hi {{1}}, we could not find a technician for your {{2}} on {{3}}. Please reschedule here — {{4}} — or we will contact you when one is available.',
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
    body: 'Plug A Pro provider credits top-up created: {{1}} = {{2}} credits. EFT to {{3}}, {{4}}, account {{5}}, branch {{6}}, {{7}}. Use exact reference: {{8}}. Credits are issued after Plug-A-Pro confirms the payment.',
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
    body: 'Your Plug-A-Pro top-up of {{1}} ({{2}} credits) has been initiated. Complete your payment on the checkout page. Credits will appear in your wallet once Payfast confirms payment.',
    examples: ['R100.00', '2'],
  },
  {
    name: 'wallet_payat_topup_initiated',
    category: 'UTILITY',
    body: 'Tap the button below to pay for your Plug-A-Pro wallet top-up. {{1}} = {{2}} credits. Credits will appear in your wallet once Pay@ confirms payment.',
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
