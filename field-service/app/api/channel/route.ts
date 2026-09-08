// POST /api/channel
// Sets the pap_channel cookie so subsequent requests resolve as VodaPay-mode
// (see lib/channel.ts#getRequestChannel). Flag-gated by channel.vodapay.v1 —
// while OFF this endpoint 404s and nothing changes for web/WhatsApp customers.
//
// Body: { channel: 'vodapay' }
// Returns: { ok: true }

import { NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { CHANNEL_COOKIE } from '@/lib/channel'

export async function POST(request: Request) {
  if (!(await isEnabled('channel.vodapay.v1'))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { channel?: unknown } | null

  if (body?.channel !== 'vodapay') {
    return NextResponse.json({ error: 'invalid_channel' }, { status: 400 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(CHANNEL_COOKIE, 'vodapay', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
