// ─── WhatsApp interactive message builders ────────────────────────────────────
// Meta Cloud API supports:
//   - Button messages: up to 3 quick-reply buttons
//   - List messages: up to 10 rows across sections (best for menus)
//   - CTA URL: single button linking to a URL (for payments, PWA links)
//   - Text: plain text (for confirmations, updates)
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages

import { logOutboundMessage } from './message-events'

const API_VERSION = 'v21.0'

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) throw new Error('Missing WhatsApp credentials')
  return { accessToken, phoneNumberId }
}

async function post(body: object): Promise<string> {
  const { accessToken, phoneNumberId } = getConfig()
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`WhatsApp send failed: ${JSON.stringify(err)}`)
  }
  const data = await res.json()
  return data.messages?.[0]?.id ?? ''
}

// ─── Text ─────────────────────────────────────────────────────────────────────

export async function sendText(
  to: string,
  text: string,
  context?: OutboundInteractiveContext
): Promise<string> {
  const externalId = await post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: false },
  })
  if (context) {
    await logOutboundMessage({
      bookingId: context.bookingId,
      to,
      templateName: context.templateName ?? 'interactive:text',
      body: text,
      externalId,
      metadata: context.metadata,
    }).catch(() => {})
  }
  return externalId
}

// ─── Buttons (max 3) ──────────────────────────────────────────────────────────

export interface QuickReply {
  id: string    // max 256 chars — returned in webhook
  title: string // max 20 chars
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: QuickReply[],
  options?: { header?: string; footer?: string },
  context?: OutboundInteractiveContext
): Promise<string> {
  const externalId = await post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(options?.header && { header: { type: 'text', text: options.header } }),
      body: { text: body },
      ...(options?.footer && { footer: { text: options.footer } }),
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  })
  if (context) {
    await logOutboundMessage({
      bookingId: context.bookingId,
      to,
      templateName: context.templateName ?? 'interactive:buttons',
      body,
      externalId,
      metadata: context.metadata,
    }).catch(() => {})
  }
  return externalId
}

// ─── List (max 10 rows, up to 10 sections) ────────────────────────────────────

export interface ListRow {
  id: string
  title: string      // max 24 chars
  description?: string // max 72 chars
}

export interface ListSection {
  title?: string     // max 24 chars
  rows: ListRow[]
}

export async function sendList(
  to: string,
  body: string,
  sections: ListSection[],
  options?: { header?: string; footer?: string; buttonLabel?: string },
  context?: OutboundInteractiveContext
): Promise<string> {
  const externalId = await post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(options?.header && { header: { type: 'text', text: options.header } }),
      body: { text: body },
      ...(options?.footer && { footer: { text: options.footer } }),
      action: {
        button: options?.buttonLabel ?? 'View Options',
        sections,
      },
    },
  })
  if (context) {
    await logOutboundMessage({
      bookingId: context.bookingId,
      to,
      templateName: context.templateName ?? 'interactive:list',
      body,
      externalId,
      metadata: context.metadata,
    }).catch(() => {})
  }
  return externalId
}

// ─── CTA URL button ───────────────────────────────────────────────────────────

export async function sendCtaUrl(
  to: string,
  body: string,
  buttonText: string,
  url: string,
  options?: { header?: string; footer?: string },
  context?: OutboundInteractiveContext
): Promise<string> {
  const externalId = await post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      ...(options?.header && { header: { type: 'text', text: options.header } }),
      body: { text: body },
      ...(options?.footer && { footer: { text: options.footer } }),
      action: {
        name: 'cta_url',
        parameters: { display_text: buttonText, url },
      },
    },
  })
  if (context) {
    await logOutboundMessage({
      bookingId: context.bookingId,
      to,
      templateName: context.templateName ?? 'interactive:cta_url',
      body,
      externalId,
      metadata: {
        ...(context.metadata ?? {}),
        url,
        buttonText,
      },
    }).catch(() => {})
  }
  return externalId
}

// ─── Parse inbound interactive replies ───────────────────────────────────────

export interface InboundReply {
  type: 'button_reply' | 'list_reply' | 'text' | 'image' | 'document' | 'other'
  id?: string      // button/list row ID
  title?: string   // button/list row title
  text?: string    // raw text (for free-text steps)
  mediaId?: string // WhatsApp media ID (for image/document)
  mimeType?: string
}

export interface OutboundInteractiveContext {
  bookingId?: string
  templateName?: string
  metadata?: Record<string, unknown>
}

export function parseInbound(message: InboundMessage): InboundReply {
  if (message.type === 'interactive') {
    const interactive = message.interactive
    if (interactive?.type === 'button_reply') {
      return {
        type: 'button_reply',
        id: interactive.button_reply?.id,
        title: interactive.button_reply?.title,
      }
    }
    if (interactive?.type === 'list_reply') {
      return {
        type: 'list_reply',
        id: interactive.list_reply?.id,
        title: interactive.list_reply?.title,
      }
    }
  }
  if (message.type === 'text') {
    return { type: 'text', text: message.text?.body?.trim() }
  }
  if (message.type === 'image' && message.image?.id) {
    return { type: 'image', mediaId: message.image.id, mimeType: message.image.mime_type, text: message.image.caption }
  }
  if (message.type === 'document' && message.document?.id) {
    return { type: 'document', mediaId: message.document.id, mimeType: message.document.mime_type, text: message.document.caption }
  }
  return { type: 'other' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InboundMessage {
  from: string
  id: string
  type: string
  text?: { body: string }
  interactive?: {
    type: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  image?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  timestamp: string
}
