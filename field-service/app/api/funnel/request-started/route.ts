import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { recordWorkflowEvent } from '@/lib/workflow-events/record'

export const dynamic = 'force-dynamic'

const SESSION_COOKIE = 'pap_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

const PayloadSchema = z.object({
  serviceId: z.string().min(1).max(64),
  source: z.string().max(32).optional(),
  landingPath: z.string().max(256).optional(),
})

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof PayloadSchema>
  try {
    parsed = PayloadSchema.parse(await request.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const jar = await cookies()
  let sessionId = jar.get(SESSION_COOKIE)?.value
  if (!sessionId) {
    sessionId = cryptoRandomId()
    jar.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }

  try {
    await recordWorkflowEvent({
      eventType: 'REQUEST_STARTED',
      actorType: 'anonymous',
      entityType: 'ANONYMOUS_SESSION',
      entityId: sessionId,
      source: parsed.source ?? 'pwa',
      metadata: {
        serviceId: parsed.serviceId,
        landingPath: parsed.landingPath,
      },
    })
  } catch {
    // Best-effort: never block the client beacon
  }

  return new NextResponse(null, { status: 204 })
}

function cryptoRandomId(): string {
  // 24 bytes → 32 chars base64url. Crypto-safe via Web Crypto in Edge/Node.
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}
