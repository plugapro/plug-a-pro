// ─── Provider Heartbeat ───────────────────────────────────────────────────────
// Upserts provider_live_status from the provider mobile app (every 2 min).
// Also called when a provider sends any inbound WhatsApp message to keep
// presence state fresh without requiring a native app.
//
// A provider is considered OFFLINE if last_heartbeat_at < now() - 10 minutes.

import { NextResponse } from 'next/server'
import { requireProvider } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(request: Request) {
  const session = await requireProvider()
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const {
    availabilityMode = 'ONLINE',
    lat,
    lng,
  }: {
    availabilityMode?: 'ONLINE' | 'ONLINE_LIMITED' | 'OFFLINE' | 'BREAK'
    lat?: number
    lng?: number
  } = body

  const isOnline = availabilityMode !== 'OFFLINE' && availabilityMode !== 'BREAK'
  const now = new Date()

  await db.providerLiveStatus.upsert({
    where: { providerId: session.providerId },
    create: {
      providerId: session.providerId,
      isOnline,
      availabilityMode,
      activeJobCount: 0,
      lastHeartbeatAt: now,
      lastLocationLat: lat ?? null,
      lastLocationLng: lng ?? null,
      lastLocationAt: lat != null ? now : null,
    },
    update: {
      isOnline,
      availabilityMode,
      lastHeartbeatAt: now,
      ...(lat != null && lng != null
        ? { lastLocationLat: lat, lastLocationLng: lng, lastLocationAt: now }
        : {}),
    },
  })

  // Mirror live location back to provider.lastKnownLat/Lng for matching fallback
  if (lat != null && lng != null) {
    await db.provider.update({
      where: { id: session.providerId },
      data: { lastKnownLat: lat, lastKnownLng: lng, lastKnownLocationAt: now },
    })
  }

  return new NextResponse(null, { status: 204 })
}
