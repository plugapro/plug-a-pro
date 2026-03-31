// WhatsApp Cloud API webhook handler
// Two roles:
//   GET  — webhook verification (Meta sends this during webhook setup)
//   POST — inbound events (delivery receipts, inbound messages)
//
// Security: GET uses verify_token; POST must be validated by checking Meta's IP range
// or by verifying the payload signature (if using the optional app-level signature).

import { type NextRequest, NextResponse, after } from 'next/server'
import { verifyWebhookChallenge } from '@/lib/whatsapp'
import { processInboundMessage } from '@/lib/whatsapp-bot'
import { db } from '@/lib/db'

// GET — Meta webhook verification challenge
export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const result = verifyWebhookChallenge(mode, token, challenge)

  if (result !== null) {
    // Return challenge as plain text — Meta requires this exact format
    return new Response(result, { status: 200 })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// POST — inbound events (delivery receipts, status updates, inbound messages)
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()

    // Validate it's from WhatsApp
    if (payload.object !== 'whatsapp_business_account') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    // Process async — acknowledge immediately to avoid Meta timeouts/retries
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value

        // Route inbound messages to conversation bot
        // Conversation is now unique on phone only — no businessId
        for (const message of value.messages ?? []) {
          after(
            processInboundMessage(message).catch((err: unknown) => {
              console.error('[webhook/whatsapp] Bot error:', err)
            })
          )
        }

        // Update delivery receipts on MessageEvent records
        for (const status of value.statuses ?? []) {
          after(
            db.messageEvent.updateMany({
              where: { externalId: status.id },
              data: {
                status:
                  status.status === 'delivered' ? 'DELIVERED'
                  : status.status === 'read' ? 'READ'
                  : status.status === 'failed' ? 'FAILED'
                  : undefined,
                deliveredAt: status.status === 'delivered' ? new Date() : undefined,
                readAt: status.status === 'read' ? new Date() : undefined,
                failureReason: status.errors?.[0]?.message,
              },
            }).catch(() => {})
          )
        }
      }
    }

    // Must return 200 quickly to prevent Meta from retrying
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('[webhook/whatsapp] Parse error:', err)
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
