import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null
const COMMIT_REF = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GIT_COMMIT_REF ?? null
const BUILT_AT = process.env.VERCEL_DEPLOYMENT_CREATED_AT ?? null

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? null
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null
const HAS_PAYMENT_CREDENTIALS =
  Boolean(process.env.PEACH_ACCESS_TOKEN && process.env.PEACH_ENTITY_ID) ||
  Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY)

async function probeWhatsApp(): Promise<'ok' | 'error' | 'unknown'> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return 'unknown'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}?fields=display_phone_number&access_token=${WHATSAPP_TOKEN}`,
      { signal: controller.signal },
    )
    clearTimeout(timeout)
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function GET() {
  const timestamp = new Date().toISOString()
  const build = {
    commitSha: COMMIT_SHA,
    commitShaShort: COMMIT_SHA ? COMMIT_SHA.slice(0, 7) : null,
    commitRef: COMMIT_REF,
    builtAt: BUILT_AT,
  }

  const [dbResult, whatsappResult] = await Promise.allSettled([
    db.$queryRaw`SELECT 1`,
    probeWhatsApp(),
  ])

  const dbOk = dbResult.status === 'fulfilled'
  const whatsapp = whatsappResult.status === 'fulfilled' ? whatsappResult.value : 'error'
  const payments: 'ok' | 'unknown' = HAS_PAYMENT_CREDENTIALS ? 'ok' : 'unknown'

  if (dbOk) {
    return NextResponse.json(
      { status: 'ok', db: 'ok', whatsapp, payments, timestamp, build },
      { status: 200 },
    )
  }
  return NextResponse.json(
    { status: 'degraded', db: 'error', whatsapp, payments, timestamp, build },
    { status: 503 },
  )
}
