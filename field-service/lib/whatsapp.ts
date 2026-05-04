// ─── Meta WhatsApp Cloud API client ──────────────────────────────────────────
// Direct integration — no intermediary required.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

import { createHmac, timingSafeEqual } from 'crypto'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { logOutboundMessage } from './message-events'
import { TEMPLATES, type TemplateName } from './messaging-templates'
import { canSend } from './whatsapp-policy'
import { isCohortMismatch, isInternalTestPhone } from './internal-test-cohort'
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from './location-format'
import { getPublicAppUrl } from './provider-credit-copy'
import { maskPhone } from './support-diagnostics'

const API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

function inferTestSubject(to: string, metadata?: Record<string, unknown>) {
  const hasExplicitCohortMarker = Boolean(
    metadata &&
      ('isTestEvent' in metadata ||
        'isTestRequest' in metadata ||
        'isTestJob' in metadata ||
        'isTestLead' in metadata)
  )
  if (!hasExplicitCohortMarker) return isInternalTestPhone(to)
  return Boolean(
    metadata?.isTestEvent ||
      metadata?.isTestRequest ||
      metadata?.isTestJob ||
      metadata?.isTestLead
  )
}

function assertCohortSendAllowed(
  to: string,
  context: { metadata?: Record<string, unknown>; allowTestCohortOverride?: boolean; templateName: string }
) {
  const subjectIsTest = inferTestSubject(to, context.metadata)
  const recipientIsTest =
    typeof context.metadata?.recipientIsTest === 'boolean'
      ? (context.metadata.recipientIsTest as boolean)
      : undefined
  if (!isCohortMismatch({
    subjectIsTest,
    recipientPhone: to,
    recipientIsTest,
    allowTestOverride: context.allowTestCohortOverride,
  })) {
    return
  }

  console.warn('[whatsapp] blocked test/live cohort mismatch', {
    to: maskPhone(to),
    template_name: context.templateName,
    subject_is_test: subjectIsTest,
    recipient_is_test: recipientIsTest ?? isInternalTestPhone(to),
  })
  throw new Error('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')
}

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      'Missing WhatsApp credentials. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.'
    )
  }

  return { accessToken, phoneNumberId }
}

// ─── Core send functions ──────────────────────────────────────────────────────

/** Send a template message. All platform-initiated messages must use approved templates. */
export async function sendTemplate(params: {
  to: string // E.164 format: +27600000000
  template: TemplateName
  components?: WhatsAppComponent[]
  languageCode?: string
  metadata?: Record<string, unknown>
  allowTestCohortOverride?: boolean
}): Promise<string> {
  const { accessToken, phoneNumberId } = getConfig()
  const templateDef = TEMPLATES[params.template]
  assertCohortSendAllowed(params.to, {
    metadata: params.metadata,
    allowTestCohortOverride: params.allowTestCohortOverride,
    templateName: params.template,
  })

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'template',
    template: {
      name: templateDef.name,
      language: { code: params.languageCode ?? templateDef.language ?? 'en_ZA' },
      components: params.components ?? [],
    },
  }

  const response = await fetch(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `WhatsApp send failed: ${JSON.stringify(error)}`
    )
  }

  const data = await response.json()
  return data.messages?.[0]?.id ?? ''
}

/** Send a free-form text message (only for replies within 24h of customer message) */
export async function sendText(params: {
  to: string
  text: string
  bookingId?: string
  templateName?: string
  metadata?: Record<string, unknown>
  allowTestCohortOverride?: boolean
}): Promise<string> {
  const { accessToken, phoneNumberId } = getConfig()
  assertCohortSendAllowed(params.to, {
    metadata: params.metadata,
    allowTestCohortOverride: params.allowTestCohortOverride,
    templateName: params.templateName ?? 'freeform:text',
  })

  const response = await fetch(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.to,
        type: 'text',
        text: { body: params.text },
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`WhatsApp send failed: ${JSON.stringify(error)}`)
  }

  const data = await response.json()
  const externalId = data.messages?.[0]?.id ?? ''

  await logOutboundMessage({
    bookingId: params.bookingId,
    to: params.to,
    templateName: params.templateName ?? 'freeform:text',
    body: params.text,
    externalId,
    metadata: params.metadata,
  }).catch(() => {})

  return externalId
}

// ─── High-level messaging functions ──────────────────────────────────────────
// These are called from booking/job lifecycle hooks.

export async function sendBookingConfirmation(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  scheduledWindow: string // "Tuesday 8 April, 09:00–12:00"
  bookingUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'booking_confirmation')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_confirmation`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: booking_confirmation)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'booking_confirmation',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.scheduledWindow },
          { type: 'text', text: params.bookingUrl },
        ],
      },
    ],
  })

  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'booking_confirmation',
    externalId,
  })
}

export async function sendProviderOnTheWay(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  providerName: string
  eta: string // "approximately 20 minutes"
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'technician_on_the_way')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: technician_on_the_way`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: technician_on_the_way)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'technician_on_the_way',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.providerName },
          { type: 'text', text: params.eta },
        ],
      },
    ],
  })

  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'technician_on_the_way',
    externalId,
  })
}

export async function sendExtraWorkApproval(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  description: string
  amount: string // formatted: "R 450.00"
  approvalUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'extra_work_approval')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: extra_work_approval`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: extra_work_approval)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'extra_work_approval',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.description },
          { type: 'text', text: params.amount },
          { type: 'text', text: params.approvalUrl },
        ],
      },
    ],
  })

  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'extra_work_approval',
    externalId,
  })
}

export async function sendJobCompleted(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  invoiceUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'job_completed')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: job_completed`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: job_completed)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'job_completed',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.invoiceUrl },
        ],
      },
    ],
  })

  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'job_completed',
    externalId,
  })
}

export async function sendProviderArrived(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  providerName: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'technician_arrived')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: technician_arrived`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: technician_arrived)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'technician_arrived',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.providerName },
        ],
      },
    ],
  })
  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'technician_arrived',
    externalId,
  })
}

export async function sendBookingReminder(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  scheduledWindow: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'booking_reminder')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_reminder`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: booking_reminder)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'booking_reminder',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.scheduledWindow },
        ],
      },
    ],
  })
  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'booking_reminder',
    externalId,
  })
}

export async function sendFollowUp(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  ratingUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'follow_up')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: follow_up`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: follow_up)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'follow_up',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.ratingUrl },
        ],
      },
    ],
  })
  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'follow_up',
    externalId,
  })
}

export async function sendQuoteReady(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  quotedPrice: string
  quoteUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'quote_ready')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: quote_ready`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: quote_ready)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'quote_ready',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.quotedPrice },
          { type: 'text', text: params.quoteUrl },
        ],
      },
    ],
  })
  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'quote_ready',
    externalId,
  })
}

export async function sendBookingCancelled(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  refundNote?: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'booking_cancelled')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_cancelled`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: booking_cancelled)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'booking_cancelled',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.refundNote ?? '' },
        ],
      },
    ],
  })
  await logMessage({
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'booking_cancelled',
    externalId,
  })
}

export async function sendPaymentReminder(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  amount: string       // formatted: "R 350.00"
  paymentUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'payment_reminder')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: payment_reminder`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: payment_reminder)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'payment_reminder',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.amount },
          { type: 'text', text: params.paymentUrl },
        ],
      },
    ],
  })
  await logMessage({ bookingId: params.bookingId, to: params.customerPhone, template: 'payment_reminder', externalId })
}

export async function sendPaymentReceived(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  amount: string
  serviceName: string
  bookingRef: string   // last 8 chars of booking ID, uppercased
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'payment_received')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: payment_received`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: payment_received)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'payment_received',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.amount },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.bookingRef },
        ],
      },
    ],
  })
  await logMessage({ bookingId: params.bookingId, to: params.customerPhone, template: 'payment_received', externalId })
}

export async function sendProviderAssigned(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  providerFirstName: string
  serviceName: string
  scheduledWindow: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'technician_assigned')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: technician_assigned`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: technician_assigned)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'technician_assigned',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.scheduledWindow },
        ],
      },
    ],
  })
  await logMessage({ bookingId: params.bookingId, to: params.customerPhone, template: 'technician_assigned', externalId })
}

export async function sendBookingRescheduled(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  oldSlot: string
  newSlot: string
  bookingUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'booking_rescheduled')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_rescheduled`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: booking_rescheduled)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'booking_rescheduled',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.oldSlot },
          { type: 'text', text: params.newSlot },
          { type: 'text', text: params.bookingUrl },
        ],
      },
    ],
  })
  await logMessage({ bookingId: params.bookingId, to: params.customerPhone, template: 'booking_rescheduled', externalId })
}

export async function sendSlotAvailable(params: {
  customerPhone: string
  customerName: string
  serviceName: string
  slotLabel: string
  bookingUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'slot_available')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. phone=${maskPhone(params.customerPhone)} template: slot_available`)
    } else {
      console.warn(`[whatsapp] blocked phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: slot_available)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'slot_available',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.slotLabel },
          { type: 'text', text: params.bookingUrl },
        ],
      },
    ],
  })
  await logOutboundMessage({ to: params.customerPhone, templateName: 'slot_available', externalId })
}

export async function sendNoProviderAvailable(params: {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  originalDate: string
  bookingUrl: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'no_technician_available')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) — suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: no_technician_available`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: no_technician_available)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'no_technician_available',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.originalDate },
          { type: 'text', text: params.bookingUrl },
        ],
      },
    ],
  })
  await logMessage({ bookingId: params.bookingId, to: params.customerPhone, template: 'no_technician_available', externalId })
}

export async function sendJobOffer(params: {
  providerPhone: string
  providerFirstName: string
  serviceName: string
  area: string         // "Sandton, Johannesburg"
  scheduledWindow: string
  jobUrl: string
  bookingId?: string   // not yet available at lead-dispatch time — optional for logging
}): Promise<void> {
  const externalId = await sendTemplate({
    to: params.providerPhone,
    template: 'job_offer',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: normaliseLocationDisplayName(params.area) },
          { type: 'text', text: params.scheduledWindow },
          { type: 'text', text: params.jobUrl },
        ],
      },
    ],
  })
  await logOutboundMessage({ bookingId: params.bookingId, to: params.providerPhone, templateName: 'job_offer', externalId })
}

export async function sendProviderJobReminder(params: {
  providerPhone: string
  providerFirstName: string
  serviceName: string
  address: string
  scheduledWindow: string
  jobUrl: string
  bookingId?: string
}): Promise<void> {
  const externalId = await sendTemplate({
    to: params.providerPhone,
    template: 'technician_job_reminder',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.address },
          { type: 'text', text: params.scheduledWindow },
          { type: 'text', text: params.jobUrl },
        ],
      },
    ],
  })
  await logOutboundMessage({ bookingId: params.bookingId, to: params.providerPhone, templateName: 'technician_job_reminder', externalId })
}

export async function sendProviderPaymentReleased(params: {
  providerPhone: string
  providerFirstName: string
  amount: string          // "R 280.00"
  serviceName: string
  arrivalEstimate: string // "1–2 business days"
  bookingId?: string
}): Promise<void> {
  const externalId = await sendTemplate({
    to: params.providerPhone,
    template: 'technician_payment_released',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.amount },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.arrivalEstimate },
        ],
      },
    ],
  })
  await logOutboundMessage({ bookingId: params.bookingId, to: params.providerPhone, templateName: 'technician_payment_released', externalId })
}

/** Notify admin when a new provider application is submitted via WhatsApp.
 *  Admin phone is set via ADMIN_WHATSAPP_NUMBER env var.
 *  Falls back silently if not configured — non-critical. */
// ─── Customer match-found notification (WA flow CW2) ─────────────────────────

export interface SendCustomerMatchFoundParams {
  customerPhone: string
  customerName: string
  providerName: string
  serviceName: string
  jobRequestId: string
}

/**
 * Notify a customer that a provider has been matched to their job request (CW2).
 *
 * Idempotency: checks `JobRequest.matchFoundWhatsappSentAt` before sending.
 * If already set the function returns early without sending a duplicate.
 */
export async function sendCustomerMatchFoundNotification(
  params: SendCustomerMatchFoundParams
): Promise<void> {
  // Idempotency guard
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: params.jobRequestId },
    select: { matchFoundWhatsappSentAt: true },
  })
  if (jobRequest?.matchFoundWhatsappSentAt) {
    return
  }

  const body = `Good news ${params.customerName}! We've found a provider for your ${params.serviceName} job. ${params.providerName} is reviewing your request and will send a quote shortly.`

  const externalId = await sendText({
    to: params.customerPhone,
    text: body,
    templateName: 'customer_match_found',
  })

  await db.jobRequest.update({
    where: { id: params.jobRequestId },
    data: { matchFoundWhatsappSentAt: new Date() },
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'customer_match_found',
    body,
    externalId,
    metadata: { jobRequestId: params.jobRequestId },
  }).catch(() => {})
}

// ─── Customer quote-ready notification (WA flow CW3) ─────────────────────────

export interface SendCustomerQuoteReadyParams {
  customerPhone: string
  customerName: string
  providerName: string
  serviceName: string
  amount: number        // in ZAR rands (e.g. 350 == R 350.00)
  validUntil: Date
  quoteId: string
  jobRequestId: string
}

/**
 * Notify a customer that a provider has submitted a quote (CW3).
 *
 * Uses `sendButtons()` (interactive message) as a stand-in while the
 * `customer_quote_ready` Meta template is pending approval. Once approved,
 * swap this for a `sendTemplate('customer_quote_ready', ...)` call.
 *
 * Idempotency: checks `Quote.approvalWhatsappSentAt` before sending.
 * If already set the function returns early without sending a duplicate.
 */
export async function sendCustomerQuoteReadyNotification(
  params: SendCustomerQuoteReadyParams
): Promise<void> {
  // Idempotency guard
  const quote = await db.quote.findUnique({
    where: { id: params.quoteId },
    select: { approvalWhatsappSentAt: true },
  })
  if (quote?.approvalWhatsappSentAt) {
    return
  }

  const validUntilStr = params.validUntil.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const amountStr = `R ${params.amount.toFixed(2)}`
  const body = `${params.providerName} has quoted ${amountStr} for your ${params.serviceName} job. Valid until ${validUntilStr}.`

  const { sendButtons } = await import('./whatsapp-interactive')

  const externalId = await sendButtons(
    params.customerPhone,
    body,
    [
      { id: `quote_accept_${params.quoteId}`, title: 'Accept quote' },
      { id: `quote_decline_${params.quoteId}`, title: 'Decline' },
    ],
    undefined,
    { templateName: 'customer_quote_ready' }
  )

  await db.quote.update({
    where: { id: params.quoteId },
    data: { approvalWhatsappSentAt: new Date() },
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'customer_quote_ready',
    body,
    externalId,
    metadata: { quoteId: params.quoteId, jobRequestId: params.jobRequestId },
  }).catch(() => {})
}

export async function sendAdminNewApplication(params: {
  applicantName: string
  applicantPhone: string
  skills: string[]
  serviceAreas: string[]
  applicationId: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return // not configured — skip silently

  const appUrl = getPublicAppUrl()
  if (!appUrl) return
  const reviewUrl = `${appUrl}/admin/applications`
  const skillList = params.skills.join(', ') || 'Not specified'
  const areaList = normaliseLocationDisplayNames(params.serviceAreas).join(', ') || 'Not specified'

  try {
    const { sendCtaUrl } = await import('./whatsapp-interactive')
    await sendCtaUrl(
      adminPhone,
      `📋 *New Provider Application*\n\n👤 ${params.applicantName}\n📞 ${params.applicantPhone}\n🔧 Skills: ${skillList}\n📍 Area: ${areaList}\n\nRef: *${params.applicationId.slice(-8).toUpperCase()}*`,
      'Review Application',
      reviewUrl,
      { footer: 'Tap to approve or reject in the admin console' }
    )
  } catch (err) {
    // Non-critical — log but don't throw
    console.error('[whatsapp] Admin notification failed:', err)
  }
}

// ─── Webhook verification ─────────────────────────────────────────────────────

/**
 * Verify the X-Hub-Signature-256 header sent by Meta on every POST webhook.
 * The signature is HMAC-SHA256 of the raw request body, keyed with WHATSAPP_APP_SECRET.
 *
 * Returns false (and rejects the request) when:
 *  - WHATSAPP_APP_SECRET is not configured
 *  - The header is missing or malformed
 *  - The computed HMAC does not match
 */
export function verifyMetaSignature(rawBody: string, signature: string): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    console.error('[whatsapp] WHATSAPP_APP_SECRET not configured — rejecting webhook')
    return false
  }

  const received = signature.startsWith('sha256=') ? signature.slice(7) : ''
  if (!received) return false

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    return false
  }
}

/** Verify the hub.verify_token during webhook setup */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && token === verifyToken) {
    return challenge
  }
  return null
}

/**
 * @deprecated Use app/api/webhooks/whatsapp/route.ts directly — it has deduplication,
 * WAMID logging, and after() async processing. This function is kept only for legacy tests.
 */
export async function processWebhookEvent(payload: WhatsAppWebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value

      // Update delivery/read status on MessageEvent records
      for (const status of value.statuses ?? []) {
        await db.messageEvent.updateMany({
          where: { externalId: status.id },
          data: {
            status:
              status.status === 'delivered'
                ? 'DELIVERED'
                : status.status === 'read'
                ? 'READ'
                : status.status === 'failed'
                ? 'FAILED'
                : undefined,
            deliveredAt:
              status.status === 'delivered' ? new Date() : undefined,
            readAt: status.status === 'read' ? new Date() : undefined,
            failureReason: status.errors?.[0]?.message,
          },
        })
      }

      // Log inbound messages (for future two-way chat support)
      for (const message of value.messages ?? []) {
        try {
          await db.inboundWhatsAppMessage.create({
            data: {
              externalId: message.id,
              phone: message.from,
              messageType: message.type,
              body: message.text?.body,
              payload: message as unknown as Prisma.InputJsonValue,
              processedAt: new Date(),
            },
          })
        } catch (error: unknown) {
          const isPrismaUnique =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code: string }).code === 'P2002'

          if (isPrismaUnique) {
            await db.inboundWhatsAppMessage.update({
              where: { externalId: message.id },
              data: {
                duplicateCount: { increment: 1 },
                lastSeenAt: new Date(),
              },
            })
            continue
          }

          throw error
        }

        const { processInboundMessage } = await import('./whatsapp-bot')
        await processInboundMessage({
          from: message.from,
          id: message.id,
          type: message.type,
          text: message.text,
          timestamp: String(Date.now()),
        })
      }
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function logMessage(params: {
  bookingId: string
  to: string
  template: TemplateName
  externalId: string
}) {
  await logOutboundMessage({
    bookingId: params.bookingId || undefined,
    to: params.to,
    templateName: params.template,
    externalId: params.externalId,
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhatsAppComponent {
  type: 'header' | 'body' | 'button'
  parameters: Array<{ type: 'text'; text: string } | { type: 'image'; image: { link: string } }>
  sub_type?: string
  index?: number
}

interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product?: string
        messages?: Array<{
          from: string
          id: string
          text?: { body: string }
          type: string
        }>
        statuses?: Array<{
          id: string
          status: string
          timestamp: string
          recipient_id?: string
          conversation?: unknown
          pricing?: unknown
          errors?: Array<{ message: string }>
        }>
      }
      field: string
    }>
  }>
}

// ─── Admin Operations Alerts ──────────────────────────────────────────────────
// All functions check ADMIN_WHATSAPP_NUMBER env var — silently skip if unset.

export async function sendAdminNoMatch(params: {
  jobRequestId: string
  category: string
  area: string
  customerName: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return
  const appUrl = getPublicAppUrl()
  if (!appUrl) return

  await sendText({
    to: adminPhone,
    text: `⚠️ *No Provider Match*\n\nJob: ${params.category}\nArea: ${normaliseLocationDisplayName(params.area)}\nCustomer: ${params.customerName}\nRef: ${params.jobRequestId.slice(-8).toUpperCase()}\n\nManual assignment needed:\n${appUrl}/admin/dispatch`,
  })
}

export async function sendAdminProviderDropped(params: {
  providerName: string
  jobId: string
  category: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return
  const appUrl = getPublicAppUrl()
  if (!appUrl) return

  await sendText({
    to: adminPhone,
    text: `🚨 *Provider Dropped Job*\n\nProvider: ${params.providerName}\nJob: ${params.category}\nRef: ${params.jobId.slice(-8).toUpperCase()}\n\nReassignment needed:\n${appUrl}/admin/bookings`,
  })
}

export async function sendAdminEscalation(params: {
  reason: string
  userPhone: string
  context: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return

  await sendText({
    to: adminPhone,
    text: `📣 *Escalation Alert*\n\nReason: ${params.reason}\nUser: ${params.userPhone}\nContext: ${params.context}\n\nPlease follow up directly.`,
  })
}
