// WhatsApp Cloud API webhook handler
// Two roles:
//   GET  — webhook verification (Meta sends this during webhook setup)
//   POST — inbound events (delivery receipts, inbound messages)
//
// Security: GET uses verify_token; POST must be validated by checking Meta's IP range
// or by verifying the payload signature (if using the optional app-level signature).

import type { Prisma } from '@prisma/client'
import { type NextRequest, NextResponse, after } from 'next/server'
import { verifyWebhookChallenge, verifyMetaSignature } from '@/lib/whatsapp'
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
  // Read raw body first — needed for signature verification
  const rawBody = await request.text()

  const reqId = crypto.randomUUID().slice(0, 8)

  // Verify the request is genuinely from Meta before touching any data
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  if (!verifyMetaSignature(rawBody, signature)) {
    console.warn(`[webhook/whatsapp:${reqId}] Rejected: invalid or missing X-Hub-Signature-256`)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const payload = JSON.parse(rawBody)

    // Validate it's from WhatsApp
    if (payload.object !== 'whatsapp_business_account') {
      console.warn(`[webhook/whatsapp:${reqId}] Unexpected object type — ignoring`)
      return NextResponse.json({ status: 'ignored' })
    }

    // Process async — acknowledge immediately to avoid Meta timeouts/retries
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value

        // Route inbound messages to conversation bot
        // Conversation is now unique on phone only — no businessId
        for (const message of value.messages ?? []) {
          after(
            (async () => {
              // Atomic WAMID dedupe — unique constraint on inbound_whatsapp_messages.externalId
              // prevents duplicate processing even under concurrent Meta retry deliveries
              try {
                await db.inboundWhatsAppMessage.create({
                  data: {
                    externalId: message.id,
                    phone:       message.from,
                    messageType: message.type,
                    body:        message.text?.body ?? null,
                    payload:     message as unknown as Prisma.InputJsonValue,
                  },
                })
              } catch (createErr: unknown) {
                const isPrismaUnique =
                  typeof createErr === 'object' &&
                  createErr !== null &&
                  'code' in createErr &&
                  (createErr as { code: string }).code === 'P2002'

                if (isPrismaUnique) {
                  // Duplicate WAMID — Meta retried a message we already logged
                  await db.inboundWhatsAppMessage
                    .update({
                      where: { externalId: message.id },
                      data:  { duplicateCount: { increment: 1 }, lastSeenAt: new Date() },
                    })
                    .catch(() => {})
                  console.warn(
                    `[webhook/whatsapp:${reqId}] Duplicate WAMID ${message.id} — skipping`
                  )
                  return
                }
                // Non-unique DB error — log but still attempt processing
                console.error(`[webhook/whatsapp:${reqId}] WAMID log error (will still process):`, createErr)
              }

              await processInboundMessage(message)

              // Mark as successfully processed for audit trail
              await db.inboundWhatsAppMessage
                .update({
                  where: { externalId: message.id },
                  data:  { processedAt: new Date() },
                })
                .catch(() => {})
            })().catch((err: unknown) => {
              console.error(`[webhook/whatsapp:${reqId}] Bot error:`, err)
              return db.inboundWhatsAppMessage.update({
                where: { externalId: message.id },
                data: {
                  failureReason: err instanceof Error ? err.message : String(err),
                  lastSeenAt: new Date(),
                },
              }).catch(() => {})
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
          // Mirror delivery state onto OtpDeliveryAttempt so the auth OTP
          // surface has end-to-end visibility instead of only knowing whether
          // Meta initially accepted the send. Different table from
          // MessageEvent because OTP sends bypass that wrapper to keep code
          // values out of message_events.body. Best-effort: failure to update
          // never blocks the webhook 200 response Meta requires.
          if (status.status === 'delivered' || status.status === 'failed') {
            after(
              db.otpDeliveryAttempt.updateMany({
                where: { whatsappMessageId: status.id },
                data: {
                  status: status.status === 'delivered' ? 'delivered' : 'failed',
                  failureCode: status.status === 'failed' ? (status.errors?.[0]?.code ? String(status.errors[0].code) : 'WA_DELIVERY_FAILED') : undefined,
                  failureReason: status.status === 'failed' ? status.errors?.[0]?.message : undefined,
                },
              }).catch(() => {})
            )
          }
        }
      }
    }

    // Must return 200 quickly to prevent Meta from retrying
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error(`[webhook/whatsapp:${reqId}] Parse error:`, err)
    return NextResponse.json({ status: 'ignored' })
  }
}
