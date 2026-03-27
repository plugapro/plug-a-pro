// ─── Push subscription registration ──────────────────────────────────────────
// POST: save a new push subscription for the authenticated technician
// DELETE: remove a subscription by endpoint

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const technician = await db.technician.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })
  if (!technician) return NextResponse.json({ error: 'Not a technician' }, { status: 403 })

  const body = await req.json()
  const { endpoint, keys } = body as {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await db.pushSubscription.upsert({
    where: { endpoint },
    create: {
      technicianId: technician.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    update: {
      technicianId: technician.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json() as { endpoint: string }
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })

  await db.pushSubscription.deleteMany({ where: { endpoint } })

  return NextResponse.json({ ok: true })
}

export async function GET() {
  // Return the VAPID public key so clients can subscribe
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) return NextResponse.json({ error: 'Push not configured' }, { status: 503 })
  return NextResponse.json({ publicKey })
}
