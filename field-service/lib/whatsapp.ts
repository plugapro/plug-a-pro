// ─── Meta WhatsApp Cloud API client ──────────────────────────────────────────
// Direct integration — no intermediary required.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

import { db } from './db'
import { TEMPLATES, type TemplateName } from './messaging-templates'

const API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

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

/** Send a template message. All business-initiated messages must use approved templates. */
export async function sendTemplate(params: {
  to: string // E.164 format: +27600000000
  template: TemplateName
  components?: WhatsAppComponent[]
  languageCode?: string
}): Promise<string> {
  const { accessToken, phoneNumberId } = getConfig()
  const templateDef = TEMPLATES[params.template]

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
}): Promise<string> {
  const { accessToken, phoneNumberId } = getConfig()

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
  return data.messages?.[0]?.id ?? ''
}

// ─── High-level messaging functions ──────────────────────────────────────────
// These are called from booking/job lifecycle hooks.

export async function sendBookingConfirmation(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  scheduledWindow: string // "Tuesday 8 April, 09:00–12:00"
  bookingUrl: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'booking_confirmation',
    externalId,
  })
}

export async function sendTechnicianOnTheWay(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  technicianName: string
  eta: string // "approximately 20 minutes"
}): Promise<void> {
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'technician_on_the_way',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.technicianName },
          { type: 'text', text: params.eta },
        ],
      },
    ],
  })

  await logMessage({
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'technician_on_the_way',
    externalId,
  })
}

export async function sendExtraWorkApproval(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  description: string
  amount: string // formatted: "R 450.00"
  approvalUrl: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'extra_work_approval',
    externalId,
  })
}

export async function sendJobCompleted(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  invoiceUrl: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'job_completed',
    externalId,
  })
}

export async function sendTechnicianArrived(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  technicianName: string
}): Promise<void> {
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'technician_arrived',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.technicianName },
        ],
      },
    ],
  })
  await logMessage({
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'technician_arrived',
    externalId,
  })
}

export async function sendBookingReminder(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  scheduledWindow: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'booking_reminder',
    externalId,
  })
}

export async function sendFollowUp(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  ratingUrl: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'follow_up',
    externalId,
  })
}

export async function sendQuoteReady(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  quotedPrice: string
  quoteUrl: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'quote_ready',
    externalId,
  })
}

export async function sendBookingCancelled(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  refundNote?: string
}): Promise<void> {
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
    businessId: params.businessId,
    bookingId: params.bookingId,
    to: params.customerPhone,
    template: 'booking_cancelled',
    externalId,
  })
}

export async function sendPaymentReminder(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  amount: string       // formatted: "R 350.00"
  paymentUrl: string
}): Promise<void> {
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
  await logMessage({ businessId: params.businessId, bookingId: params.bookingId, to: params.customerPhone, template: 'payment_reminder', externalId })
}

export async function sendPaymentReceived(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  amount: string
  serviceName: string
  bookingRef: string   // last 8 chars of booking ID, uppercased
}): Promise<void> {
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
  await logMessage({ businessId: params.businessId, bookingId: params.bookingId, to: params.customerPhone, template: 'payment_received', externalId })
}

export async function sendTechnicianAssigned(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  technicianFirstName: string
  serviceName: string
  scheduledWindow: string
}): Promise<void> {
  const externalId = await sendTemplate({
    to: params.customerPhone,
    template: 'technician_assigned',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.customerName },
          { type: 'text', text: params.technicianFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.scheduledWindow },
        ],
      },
    ],
  })
  await logMessage({ businessId: params.businessId, bookingId: params.bookingId, to: params.customerPhone, template: 'technician_assigned', externalId })
}

export async function sendBookingRescheduled(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  oldSlot: string
  newSlot: string
  bookingUrl: string
}): Promise<void> {
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
  await logMessage({ businessId: params.businessId, bookingId: params.bookingId, to: params.customerPhone, template: 'booking_rescheduled', externalId })
}

export async function sendSlotAvailable(params: {
  businessId: string
  customerPhone: string
  customerName: string
  serviceName: string
  slotLabel: string
  bookingUrl: string
}): Promise<void> {
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
  await logMessage({ businessId: params.businessId, bookingId: '', to: params.customerPhone, template: 'slot_available', externalId })
}

export async function sendNoTechnicianAvailable(params: {
  businessId: string
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  originalDate: string
  bookingUrl: string
}): Promise<void> {
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
  await logMessage({ businessId: params.businessId, bookingId: params.bookingId, to: params.customerPhone, template: 'no_technician_available', externalId })
}

export async function sendJobOffer(params: {
  technicianPhone: string
  technicianFirstName: string
  serviceName: string
  area: string         // "Sandton, Johannesburg"
  scheduledWindow: string
  jobUrl: string
}): Promise<void> {
  await sendTemplate({
    to: params.technicianPhone,
    template: 'job_offer',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.technicianFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.area },
          { type: 'text', text: params.scheduledWindow },
          { type: 'text', text: params.jobUrl },
        ],
      },
    ],
  })
  // No DB log needed — no bookingId in context
}

export async function sendTechnicianJobReminder(params: {
  technicianPhone: string
  technicianFirstName: string
  serviceName: string
  address: string
  scheduledWindow: string
  jobUrl: string
}): Promise<void> {
  await sendTemplate({
    to: params.technicianPhone,
    template: 'technician_job_reminder',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.technicianFirstName },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.address },
          { type: 'text', text: params.scheduledWindow },
          { type: 'text', text: params.jobUrl },
        ],
      },
    ],
  })
}

export async function sendTechnicianPaymentReleased(params: {
  technicianPhone: string
  technicianFirstName: string
  amount: string          // "R 280.00"
  serviceName: string
  arrivalEstimate: string // "1–2 business days"
}): Promise<void> {
  await sendTemplate({
    to: params.technicianPhone,
    template: 'technician_payment_released',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.technicianFirstName },
          { type: 'text', text: params.amount },
          { type: 'text', text: params.serviceName },
          { type: 'text', text: params.arrivalEstimate },
        ],
      },
    ],
  })
}

/** Notify admin when a new technician application is submitted via WhatsApp.
 *  Admin phone is set via ADMIN_WHATSAPP_NUMBER env var.
 *  Falls back silently if not configured — non-critical. */
export async function sendAdminNewApplication(params: {
  applicantName: string
  applicantPhone: string
  skills: string[]
  serviceAreas: string[]
  applicationId: string
}): Promise<void> {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER
  if (!adminPhone) return // not configured — skip silently

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const reviewUrl = `${appUrl}/admin/applications`
  const skillList = params.skills.join(', ') || 'Not specified'
  const areaList = params.serviceAreas.join(', ') || 'Not specified'

  try {
    const { sendCtaUrl } = await import('./whatsapp-interactive')
    await sendCtaUrl(
      adminPhone,
      `📋 *New Technician Application*\n\n👤 ${params.applicantName}\n📞 ${params.applicantPhone}\n🔧 Skills: ${skillList}\n📍 Area: ${areaList}\n\nRef: *${params.applicationId.slice(-8).toUpperCase()}*`,
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

/** Process an inbound webhook payload (delivery receipts + inbound messages) */
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
        // TODO: route inbound messages to admin notification or automated reply
        console.log('[WhatsApp inbound]', message.from, message.text?.body)
      }
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function logMessage(params: {
  businessId: string
  bookingId: string
  to: string
  template: TemplateName
  externalId: string
}) {
  await db.messageEvent.create({
    data: {
      businessId: params.businessId,
      bookingId: params.bookingId,
      channel: 'WHATSAPP',
      templateName: params.template,
      to: params.to,
      externalId: params.externalId,
      status: 'SENT',
      sentAt: new Date(),
    },
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhatsAppComponent {
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
