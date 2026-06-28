// ─── Meta WhatsApp Cloud API client ──────────────────────────────────────────
// Direct integration - no intermediary required.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

import type { Prisma } from '@prisma/client'
import { db } from './db'
import { logOutboundMessage } from './message-events'
import { TEMPLATES, type TemplateName } from './messaging-templates'
import { canSend } from './whatsapp-policy'
import { isCohortMismatch, isInternalTestPhone } from './internal-test-cohort'
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from './location-format'
import { getPublicAppUrl } from './provider-credit-copy'
import { maskPhone } from './support-diagnostics'
import { assertNoRawUrlsInWhatsAppBody, ctaLabelFor } from './whatsapp-copy'

export type { TemplateName } from './messaging-templates'

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

// ENVIRONMENT ISOLATION WARNING
// There is no separate staging WhatsApp phone number or WABA. Both staging and
// production read the same WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID
// env vars and hit the same Meta-registered sender.
//
// The only guard against staging sends reaching real users is the test-cohort
// gate in assertSendAllowed() above. It blocks sends to numbers not in the
// internal test cohort when NODE_ENV !== 'production' and vice versa.
//
// Before adding a new environment: register a dedicated staging phone number in
// Meta Business Suite and point WHATSAPP_PHONE_NUMBER_ID at it. Do NOT rely
// solely on the cohort gate as the isolation boundary.
function getConfig() {
  // Defensive trim - past incident where a value was pasted into Vercel with
  // a trailing literal "\n" (backslash-n, not a real newline). That breaks
  // the Authorization header and Meta rejects every send with code 190
  // "Malformed access token". Strip surrounding whitespace and a stray
  // trailing literal-backslash-n so a copy-paste mishap can't take auth out.
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim().replace(/\\n$/, '')
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

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
  assertTemplateBodyComponentsDoNotContainRawUrls(params.template, params.components ?? [])

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
    const metaCode = error?.error?.code
    // Meta error codes 132000 / 132001 / 132007 indicate the template is not yet
    // approved, is paused or was rejected. Surface these explicitly so deployment
    // logs immediately show the approval dependency rather than a generic send failure.
    if (metaCode === 132000 || metaCode === 132001 || metaCode === 132007) {
      throw new Error(
        `[TEMPLATE_NOT_APPROVED] Template "${params.template}" is not approved or does not exist in Meta Business Manager. Approve it before deploying. code=${metaCode}`
      )
    }
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
  recordMessageEvent?: boolean
}): Promise<string> {
  const { accessToken, phoneNumberId } = getConfig()
  assertCohortSendAllowed(params.to, {
    metadata: params.metadata,
    allowTestCohortOverride: params.allowTestCohortOverride,
    templateName: params.templateName ?? 'freeform:text',
  })
  assertNoRawUrlsInWhatsAppBody(params.text, params.templateName ?? 'freeform:text')

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

  if (params.recordMessageEvent !== false) {
    await logOutboundMessage({
      bookingId: params.bookingId,
      to: params.to,
      templateName: params.templateName ?? 'freeform:text',
      body: params.text,
      externalId,
      metadata: params.metadata,
    }).catch((err: unknown) => { console.error('[whatsapp] message log failed', err) })
  }

  return externalId
}

function assertTemplateBodyComponentsDoNotContainRawUrls(templateName: string, components: WhatsAppComponent[]) {
  for (const component of components) {
    if (component.type !== 'body' && component.type !== 'header') continue
    component.parameters.forEach((parameter, index) => {
      if (parameter.type !== 'text') return
      assertNoRawUrlsInWhatsAppBody(parameter.text, `${templateName}:${component.type}:${index}`)
    })
  }
}

function urlButtonComponent(index: number, url: string): WhatsAppComponent {
  return {
    type: 'button',
    sub_type: 'url',
    index,
    parameters: [{ type: 'text', text: url }],
  }
}

function providerLeadAccessButtonComponent(index: number, jobUrl: string): WhatsAppComponent {
  try {
    const url = new URL(jobUrl)
    const match = url.pathname.match(/\/leads\/access\/([^/?#]+)/)
    if (match?.[1]) return urlButtonComponent(index, match[1])
  } catch {
    // Fall through to the raw-url guard below. A malformed URL must never be
    // sent as visible text, but surfacing the context helps find bad callers.
  }
  throw new Error('Invalid provider lead access URL for WhatsApp template button')
}

function providerVerifyButtonComponent(index: number, verificationUrl: string): WhatsAppComponent {
  try {
    const url = new URL(verificationUrl)
    const match = url.pathname.match(/\/provider\/verify\/([^/?#]+)/)
    if (match?.[1]) return urlButtonComponent(index, match[1])
  } catch {
    // Fall through to the raw-url guard below. A malformed URL must never be
    // sent as visible text, but surfacing the context helps find bad callers.
  }
  throw new Error('Invalid provider verification URL for WhatsApp template button')
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_confirmation`)
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
        ],
      },
      urlButtonComponent(0, params.bookingUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: technician_on_the_way`)
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: extra_work_approval`)
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
        ],
      },
      urlButtonComponent(0, params.approvalUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: job_completed`)
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
        ],
      },
      urlButtonComponent(0, params.invoiceUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: technician_arrived`)
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_reminder`)
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: follow_up`)
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
        ],
      },
      urlButtonComponent(0, params.ratingUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: quote_ready`)
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
        ],
      },
      urlButtonComponent(0, params.quoteUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_cancelled`)
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: payment_reminder`)
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
        ],
      },
      urlButtonComponent(0, params.paymentUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: payment_received`)
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: technician_assigned`)
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: booking_rescheduled`)
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
        ],
      },
      urlButtonComponent(0, params.bookingUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. phone=${maskPhone(params.customerPhone)} template: slot_available`)
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
        ],
      },
      urlButtonComponent(0, params.bookingUrl),
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
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)} template: no_technician_available`)
    } else {
      console.warn(`[whatsapp] blocked bookingId=${params.bookingId} phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: no_technician_available)`)
    }
    return
  }
  // The live Meta template body is:
  //   "Hi {{1}}, we could not match a provider for your {{2}} on {{3}}.
  //    Please reschedule here — {{4}} — or we will contact you when one is available."
  // {{4}} is an inline URL in the body text, NOT a template URL button. Sending a button
  // component or fewer than 4 body params fails Meta error 132000.
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

/**
 * Prompt a customer to confirm a date with the provider who has accepted their request.
 *
 * Closes the gap when the post-match auto-notification (`post_match_customer_provider_accepted`)
 * fails Re-engagement because the customer's last inbound was >24h ago. UTILITY template,
 * works outside the 24h window. Send only after the provider has accepted (Match.status='MATCHED').
 *
 * Requires the `please_confirm_with_provider` template to be APPROVED in Meta Business Manager.
 * If the template is not yet approved, sendTemplate will throw [TEMPLATE_NOT_APPROVED]; the
 * caller should fall back to manual ops outreach until then.
 */
export async function sendPleaseConfirmWithProvider(params: {
  customerPhone: string
  customerName: string
  providerName: string
  serviceName: string
  requestUrl: string
  jobRequestId?: string
  matchId?: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'please_confirm_with_provider')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. phone=${maskPhone(params.customerPhone)} template: please_confirm_with_provider`)
    } else {
      console.warn(`[whatsapp] blocked phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: please_confirm_with_provider)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'please_confirm_with_provider',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.providerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.requestUrl },
        ],
      },
    ],
    metadata: {
      jobRequestId: params.jobRequestId,
      matchId: params.matchId,
    },
  })
  await logOutboundMessage({ to: params.customerPhone, templateName: 'please_confirm_with_provider', externalId })
}

/**
 * Nudge a customer who abandoned a service-request flow mid-way to come back and finish.
 *
 * UTILITY template, works outside the 24h window. Send only to phones that started
 * `flow=job_request` but did not reach `submit` and have not received this nudge already.
 *
 * Requires the `customer_abandoned_recovery` template to be APPROVED in Meta Business
 * Manager. If not yet approved, sendTemplate throws [TEMPLATE_NOT_APPROVED]; callers
 * should treat that as a soft failure and try again on the next cron cycle.
 */
export async function sendCustomerAbandonedRecovery(params: {
  customerPhone: string
  customerName: string
  serviceCategory: string
  pickupUrl: string
  conversationId?: string
}): Promise<void> {
  const check = await canSend(params.customerPhone, 'customer_abandoned_recovery')
  if (!check.allowed) {
    if (check.reason === 'db_error') {
      console.error(`[whatsapp] policy check failed (db_error) - suppressing send. phone=${maskPhone(params.customerPhone)} template: customer_abandoned_recovery`)
    } else {
      console.warn(`[whatsapp] blocked phone=${maskPhone(params.customerPhone)}: ${check.reason} (template: customer_abandoned_recovery)`)
    }
    return
  }
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'customer_abandoned_recovery',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.serviceCategory },
          { type: 'text', text: params.pickupUrl },
        ],
      },
    ],
    metadata: {
      conversationId: params.conversationId,
    },
  })
  await logOutboundMessage({ to: params.customerPhone, templateName: 'customer_abandoned_recovery', externalId })
}

export async function sendJobOffer(params: {
  providerPhone: string
  providerFirstName: string
  serviceName: string
  area: string         // "Sandton, Johannesburg"
  scheduledWindow: string
  jobUrl: string
  templateName?: 'provider_lead_offer' | 'quick_match_provider_lead_offer' | 'provider_rfp_lead_invite'
  bookingId?: string   // not yet available at lead-dispatch time - optional for logging
  metadata?: Record<string, unknown>
}): Promise<string> {
  // Provider job-offer links must travel as a URL button parameter only. Never
  // add the signed lead URL as a body variable; the token would be visible in
  // the WhatsApp chat transcript.
  const templateName = params.templateName ?? 'provider_lead_offer'
  const externalId = await sendTemplate({
    to: params.providerPhone,
    template: templateName,
    metadata: params.metadata,
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: normaliseLocationDisplayName(params.area) },
          { type: 'text', text: params.scheduledWindow },
        ],
      },
      providerLeadAccessButtonComponent(0, params.jobUrl),
    ],
  })
  await logOutboundMessage({
    bookingId: params.bookingId,
    to: params.providerPhone,
    templateName,
    externalId,
    metadata: params.metadata,
  })
  return externalId
}

export async function sendProviderKycNudge(params: {
  providerPhone: string
  providerFirstName: string
  deadline: string
  verificationUrl: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  // The signed verification link must travel as a URL button parameter only,
  // mirroring provider job-offer links: the token must never be visible in the
  // WhatsApp chat transcript as body text.
  //
  // Deliberately does NOT log a MessageEvent: the kyc-drive orchestrator
  // records the attempt BEFORE sending so the politeness cadence (max sends,
  // spacing) can never be lost to a post-send logging failure.
  const externalId = await sendTemplate({
    to: params.providerPhone,
    template: 'provider_kyc_nudge',
    metadata: params.metadata,
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.deadline },
        ],
      },
      providerVerifyButtonComponent(0, params.verificationUrl),
    ],
  })
  return externalId
}

// In-flight identity-verification re-nudges (provider_verification_resume_*).
// Sent ~24h after a provider stalls mid-verification. Each pair below mirrors
// sendProviderKycNudge: the signed verify URL travels as a URL button param
// only, and the send deliberately does NOT log a MessageEvent — the orchestrator
// in lib/identity-verification/in-flight-renudge.ts records the attempt BEFORE
// sending so the politeness cadence (24h dedup, lifetime cap) holds across
// crashes and post-send write failures.

export async function sendProviderVerificationResumeConsent(params: {
  providerPhone: string
  providerFirstName: string
  verificationUrl: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  return sendTemplate({
    to: params.providerPhone,
    template: 'provider_verification_resume_consent',
    metadata: params.metadata,
    components: [
      {
        type: 'body',
        parameters: [{ type: 'text', text: params.providerFirstName }],
      },
      providerVerifyButtonComponent(0, params.verificationUrl),
    ],
  })
}

export async function sendProviderVerificationResumeDocument(params: {
  providerPhone: string
  providerFirstName: string
  documentFriendlyName: string
  verificationUrl: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  return sendTemplate({
    to: params.providerPhone,
    template: 'provider_verification_resume_document',
    metadata: params.metadata,
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.providerFirstName },
          { type: 'text', text: params.documentFriendlyName },
        ],
      },
      providerVerifyButtonComponent(0, params.verificationUrl),
    ],
  })
}

export async function sendProviderVerificationResumeSelfie(params: {
  providerPhone: string
  providerFirstName: string
  verificationUrl: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  return sendTemplate({
    to: params.providerPhone,
    template: 'provider_verification_resume_selfie',
    metadata: params.metadata,
    components: [
      {
        type: 'body',
        parameters: [{ type: 'text', text: params.providerFirstName }],
      },
      providerVerifyButtonComponent(0, params.verificationUrl),
    ],
  })
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
        ],
      },
      urlButtonComponent(0, params.jobUrl),
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
 *  Falls back silently if not configured - non-critical. */
// ─── Customer match-found notification (WA flow CW2) ─────────────────────────

export interface SendCustomerMatchFoundParams {
  customerPhone: string
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
  if (!params.customerPhone) return

  // Consent gate: enforce opt-out/opt-in by template category before sending.
  const policy = await canSend(params.customerPhone, 'customer_match_found')
  if (!policy.allowed) {
    console.warn('[whatsapp] blocked customer_match_found by policy', {
      phone: maskPhone(params.customerPhone), jobRequestId: params.jobRequestId, reason: policy.reason,
    })
    return
  }

  // Atomic idempotency guard - prevents duplicate sends when cron and the
  // fire-and-forget path race through the same job.
  const reserved = await db.jobRequest.updateMany({
    where: { id: params.jobRequestId, matchFoundWhatsappSentAt: null },
    data: { matchFoundWhatsappSentAt: new Date() },
  })
  if (reserved.count === 0) return

  const providerFirstName = params.providerName.split(' ')[0]

  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'customer_match_found',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: providerFirstName },
          { type: 'text', text: params.serviceName },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: params.jobRequestId }],
      },
    ],
  }).catch(async (err) => {
    // Roll back the sentinel if the send fails so a future caller can retry.
    await db.jobRequest.updateMany({
      where: { id: params.jobRequestId },
      data: { matchFoundWhatsappSentAt: null },
    }).catch(() => undefined)
    throw err
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'customer_match_found',
    externalId,
    metadata: { jobRequestId: params.jobRequestId },
  }).catch((err: unknown) => { console.error('[whatsapp] message log failed', err) })
}

// ─── Customer quote-ready notification (WA flow CW3) ─────────────────────────

export interface SendCustomerQuoteReadyParams {
  customerPhone: string
  customerName: string
  providerName: string
  serviceName: string
  amount: number           // in ZAR rands (e.g. 350 == R 350.00)
  estimatedHours?: number
  shortDescription: string
  validUntil: Date
  quoteId: string
  jobRequestId: string
}

/**
 * Notify a customer that a provider has submitted a quote (CW3).
 *
 * Idempotency: checks `Quote.approvalWhatsappSentAt` before sending.
 * If already set the function returns early without sending a duplicate.
 */
export async function sendCustomerQuoteReadyNotification(
  params: SendCustomerQuoteReadyParams
): Promise<void> {
  // Consent gate: enforce opt-out/opt-in by template category before sending.
  const policy = await canSend(params.customerPhone, 'customer_quote_ready')
  if (!policy.allowed) {
    console.warn('[whatsapp] blocked customer_quote_ready by policy', {
      phone: maskPhone(params.customerPhone), quoteId: params.quoteId, reason: policy.reason,
    })
    return
  }

  // Idempotency guard
  const quote = await db.quote.findUnique({
    where: { id: params.quoteId },
    select: { approvalWhatsappSentAt: true },
  })
  if (quote?.approvalWhatsappSentAt) {
    return
  }

  const customerFirstName = params.customerName.split(' ')[0]
  const amountStr = `R ${params.amount.toFixed(2)}`
  const estimatedHoursStr = params.estimatedHours != null ? String(params.estimatedHours) : 'TBD'
  const validUntilStr = params.validUntil.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'customer_quote_ready',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: customerFirstName },
          { type: 'text', text: params.providerName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: amountStr },
          { type: 'text', text: estimatedHoursStr },
          { type: 'text', text: validUntilStr },
          { type: 'text', text: params.shortDescription },
        ],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: 0,
        parameters: [{ type: 'payload', payload: `quote_accept_${params.quoteId}` }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: 1,
        parameters: [{ type: 'payload', payload: `quote_decline_${params.quoteId}` }],
      },
    ],
  })

  await db.quote.update({
    where: { id: params.quoteId },
    data: { approvalWhatsappSentAt: new Date() },
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'customer_quote_ready',
    externalId,
    metadata: { quoteId: params.quoteId, jobRequestId: params.jobRequestId },
  }).catch((err: unknown) => { console.error('[whatsapp] message log failed', err) })
}

// ─── Customer en-route notification (WA flow PW2) ────────────────────────────

/**
 * Notify a customer that their provider is on the way (PW2).
 *
 * Sent after the provider shares their current location via WhatsApp.
 * Idempotency: checks `JobRequest.enRouteWhatsappSentAt` before sending.
 */
export async function sendCustomerEnRouteNotification(params: {
  customerPhone: string
  providerName: string
  jobCategory: string
  jobSuburb: string
  jobRequestId: string
}): Promise<void> {
  // Consent gate: enforce opt-out/opt-in by template category before sending.
  const policy = await canSend(params.customerPhone, 'customer_provider_en_route')
  if (!policy.allowed) {
    console.warn('[whatsapp] blocked customer_provider_en_route by policy', {
      phone: maskPhone(params.customerPhone), jobRequestId: params.jobRequestId, reason: policy.reason,
    })
    return
  }

  // Idempotency guard
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: params.jobRequestId },
    select: { enRouteWhatsappSentAt: true },
  })
  if (jobRequest?.enRouteWhatsappSentAt) {
    return
  }

  const providerFirstName = params.providerName.split(' ')[0]

  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'customer_provider_en_route',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: providerFirstName },
          { type: 'text', text: params.jobCategory },
          { type: 'text', text: params.jobSuburb },
        ],
      },
    ],
  })

  await db.jobRequest.update({
    where: { id: params.jobRequestId },
    data: { enRouteWhatsappSentAt: new Date() },
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'customer_provider_en_route',
    externalId,
    metadata: { jobRequestId: params.jobRequestId },
  }).catch((err: unknown) => { console.error('[whatsapp] message log failed', err) })
}

export async function sendAdminNewApplication(params: {
  applicantName: string
  applicantPhone: string
  skills: string[]
  serviceAreas: string[]
  applicationId: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return // not configured - skip silently

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
    // Non-critical - log but don't throw
    console.error('[whatsapp] Admin notification failed:', err)
  }
}

// ─── Webhook verification ─────────────────────────────────────────────────────

// verifyMetaSignature and verifyWebhookChallenge live in webhook-auth.ts
// (pure crypto - no DB, no HTTP) so tests can use vi.importActual() safely.
export { verifyMetaSignature, verifyWebhookChallenge } from './webhook-auth'

/**
 * @deprecated Use app/api/webhooks/whatsapp/route.ts directly - it has deduplication,
 * WAMID logging and after() async processing. This function is kept only for legacy tests.
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
  parameters: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: { link: string } }
    | { type: 'payload'; payload: string }
  >
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
// All functions check ADMIN_WHATSAPP_NUMBER env var - silently skip if unset.

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

  const { sendCtaUrl } = await import('./whatsapp-interactive')
  await sendCtaUrl(
    adminPhone,
    `⚠️ *No Provider Match*\n\nJob: ${params.category}\nArea: ${normaliseLocationDisplayName(params.area)}\nCustomer: ${params.customerName}\nRef: ${params.jobRequestId.slice(-8).toUpperCase()}\n\nManual assignment needed.`,
    ctaLabelFor('generic_details'),
    `${appUrl}/admin/dispatch`,
    undefined,
    { templateName: 'admin:no_provider_match' },
  ).catch((error: unknown) => {
    console.error('[whatsapp] admin no-match CTA send failed', error)
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

  const { sendCtaUrl } = await import('./whatsapp-interactive')
  await sendCtaUrl(
    adminPhone,
    `🚨 *Provider Dropped Job*\n\nProvider: ${params.providerName}\nJob: ${params.category}\nRef: ${params.jobId.slice(-8).toUpperCase()}\n\nReassignment needed.`,
    ctaLabelFor('generic_details'),
    `${appUrl}/admin/bookings`,
    undefined,
    { templateName: 'admin:provider_dropped_job' },
  ).catch((error: unknown) => {
    console.error('[whatsapp] admin provider-dropped CTA send failed', error)
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

// ─── M5-T3: Running-late customer notification (PW3) ─────────────────────────

/**
 * Notify a customer that their provider is running late.
 * Called from handleRunningLateFlow in provider-journey.ts.
 *
 * Idempotency: checks and sets `Job.runningLateWhatsappSentAt`. The field is
 * written inside this function so the guard is always paired with the send,
 * regardless of what the caller does afterward.
 */
export async function sendCustomerRunningLateNotification(params: {
  customerPhone: string
  customerFirstName: string
  providerName: string
  delayLabel: string
  jobCategory: string
  jobId: string
}): Promise<void> {
  // Consent gate: enforce opt-out/opt-in by template category before sending.
  const policy = await canSend(params.customerPhone, 'customer_provider_running_late')
  if (!policy.allowed) {
    console.warn('[whatsapp] blocked customer_provider_running_late by policy', {
      phone: maskPhone(params.customerPhone), jobId: params.jobId, reason: policy.reason,
    })
    return
  }

  // Idempotency guard - owned here so duplicate webhook deliveries are blocked
  // even if the caller's JobStatusEvent write hasn't committed yet.
  const job = await db.job.findUnique({
    where: { id: params.jobId },
    select: { runningLateWhatsappSentAt: true },
  })
  if (job?.runningLateWhatsappSentAt) return

  const providerFirstName = params.providerName.split(' ')[0]

  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'customer_provider_running_late',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerFirstName },
          { type: 'text', text: providerFirstName },
          { type: 'text', text: params.delayLabel },
          { type: 'text', text: params.jobCategory },
        ],
      },
    ],
  })

  await db.job.update({
    where: { id: params.jobId },
    data: { runningLateWhatsappSentAt: new Date() },
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'customer_provider_running_late',
    externalId,
    metadata: { jobId: params.jobId },
  }).catch((err: unknown) => { console.error('[whatsapp] message log failed', err) })
}

// ─── M5-T5: Provider invoice send (PW5) ──────────────────────────────────────

/**
 * Send a post-job invoice to the customer using the provider_invoice_send template.
 * Called from handleInvoiceFlow in provider-journey.ts.
 *
 * Idempotency: checks `Job.invoiceWhatsappSentAt` before sending.
 */
// ─── Pilot - post-job completion check (PCC1) ────────────────────────────────

export async function sendCompletionCheckMessage(params: {
  customerPhone: string; customerName: string; providerName: string
  serviceName: string; matchId: string; isTest?: boolean
}): Promise<string> {
  const customerFirstName = params.customerName.split(' ')[0]
  const providerFirstName = params.providerName.split(' ')[0]
  return sendTemplate({
    to: params.customerPhone,
    template: 'post_job_completion_check',
    components: [
      { type: 'body', parameters: [{ type: 'text', text: customerFirstName }, { type: 'text', text: providerFirstName }, { type: 'text', text: params.serviceName }] },
      { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: `completion_yes_${params.matchId}` }] },
      { type: 'button', sub_type: 'quick_reply', index: 1, parameters: [{ type: 'payload', payload: `completion_no_${params.matchId}` }] },
    ],
    metadata: { matchId: params.matchId },
    allowTestCohortOverride: params.isTest,
  })
}

export async function sendCustomerReviewRequest(params: {
  customerPhone: string; customerName: string; providerName: string
  serviceName: string; reviewUrl: string; matchId: string; isTest?: boolean
}): Promise<void> {
  const { sendCtaUrl } = await import('./whatsapp-interactive')
  const customerFirstName = params.customerName.split(' ')[0]
  const providerFirstName = params.providerName.split(' ')[0]
  const body = `Great! Thanks for confirming, ${customerFirstName}. Would you like to leave a quick review for ${providerFirstName}? Reviews help other customers and take less than a minute.`
  await sendCtaUrl(params.customerPhone, body, 'Leave a review', params.reviewUrl, undefined, { templateName: 'review:customer_cta', metadata: { matchId: params.matchId } })
}

export async function sendProviderReviewNudge(params: {
  providerPhone: string; providerName: string; customerName: string
  serviceName: string; reviewUrl: string; matchId: string; isTest?: boolean
}): Promise<string> {
  const providerFirstName = params.providerName.split(' ')[0]
  const customerFirstName = params.customerName.split(' ')[0]
  let tokenSuffix: string
  try {
    const url = new URL(params.reviewUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    tokenSuffix = parts[parts.length - 1]
    if (!tokenSuffix) throw new Error('empty token')
  } catch {
    throw new Error(`Invalid review URL for WhatsApp template button: ${params.reviewUrl}`)
  }
  return sendTemplate({
    to: params.providerPhone,
    template: 'post_job_provider_review_nudge',
    components: [
      { type: 'body', parameters: [{ type: 'text', text: providerFirstName }, { type: 'text', text: customerFirstName }, { type: 'text', text: params.serviceName }] },
      { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: tokenSuffix }] },
    ],
    metadata: { matchId: params.matchId },
    allowTestCohortOverride: params.isTest,
  })
}

export async function sendProviderInvoiceTemplate(params: {
  customerPhone: string
  customerFullName: string
  serviceLabel: string
  suburb: string
  city: string
  completionDate: string  // pre-formatted, e.g. "4 May 2026"
  labourCost: string      // pre-formatted, e.g. "R 350.00"
  materialsCost: string   // pre-formatted, e.g. "R 50.00"
  totalAmount: string     // pre-formatted, e.g. "R 400.00"
  jobRef: string          // last 8 chars of booking ID, uppercase
  providerFullName: string
  jobId: string
}): Promise<void> {
  // Consent gate: invoices carry customer name, amount and booking reference, so
  // they must respect the customer's WhatsApp service opt-out.
  const policy = await canSend(params.customerPhone, 'provider_invoice_send')
  if (!policy.allowed) {
    console.warn('[whatsapp] blocked provider_invoice_send by policy', {
      phone: maskPhone(params.customerPhone), jobId: params.jobId, reason: policy.reason,
    })
    return
  }

  // Idempotency guard
  const job = await db.job.findUnique({
    where: { id: params.jobId },
    select: { invoiceWhatsappSentAt: true },
  })
  if (job?.invoiceWhatsappSentAt) return

  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'provider_invoice_send',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerFullName },
          { type: 'text', text: params.serviceLabel },
          { type: 'text', text: params.suburb },
          { type: 'text', text: params.city },
          { type: 'text', text: params.completionDate },
          { type: 'text', text: params.labourCost },
          { type: 'text', text: params.materialsCost },
          { type: 'text', text: params.totalAmount },
          { type: 'text', text: params.jobRef },
          { type: 'text', text: params.providerFullName },
        ],
      },
    ],
  })

  await db.job.update({
    where: { id: params.jobId },
    data: { invoiceWhatsappSentAt: new Date() },
  })

  await logOutboundMessage({
    to: params.customerPhone,
    templateName: 'provider_invoice_send',
    externalId,
    metadata: { jobId: params.jobId },
  }).catch((err: unknown) => { console.error('[whatsapp] message log failed', err) })
}
