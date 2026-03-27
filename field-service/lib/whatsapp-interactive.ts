// ─── WhatsApp interactive message builders ────────────────────────────────────
// Meta Cloud API supports:
//   - Button messages: up to 3 quick-reply buttons
//   - List messages: up to 10 rows across sections (best for menus)
//   - CTA URL: single button linking to a URL (for payments, PWA links)
//   - Text: plain text (for confirmations, updates)
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages

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

export async function sendText(to: string, text: string): Promise<string> {
  return post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: false },
  })
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
  options?: { header?: string; footer?: string }
): Promise<string> {
  return post({
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
  options?: { header?: string; footer?: string; buttonLabel?: string }
): Promise<string> {
  return post({
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
}

// ─── CTA URL button ───────────────────────────────────────────────────────────

export async function sendCtaUrl(
  to: string,
  body: string,
  buttonText: string,
  url: string,
  options?: { header?: string; footer?: string }
): Promise<string> {
  return post({
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
}

// ─── Parse inbound interactive replies ───────────────────────────────────────

export interface InboundReply {
  type: 'button_reply' | 'list_reply' | 'text' | 'other'
  id?: string     // button/list row ID
  title?: string  // button/list row title
  text?: string   // raw text (for free-text steps)
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
  timestamp: string
}
