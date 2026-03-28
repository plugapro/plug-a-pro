// ─── Web Push notification helper ─────────────────────────────────────────────
// Uses the `web-push` package to deliver push notifications to providers.
// Requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in env.
//
// Generate VAPID keys:
//   npx web-push generate-vapid-keys

import webPush from 'web-push'
import { db } from '@/lib/db'

// Configure VAPID once on module load
if (
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY &&
  process.env.VAPID_SUBJECT
) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

// ─── Core send ────────────────────────────────────────────────────────────────

export async function sendPushNotification(params: {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  title: string
  body: string
  url?: string
}): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not configured — notification not delivered.')
    return
  }

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url,
  })

  try {
    await webPush.sendNotification(
      {
        endpoint: params.subscription.endpoint,
        keys: params.subscription.keys,
      },
      payload
    )
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 410 || status === 404) {
      // Subscription expired — clean it up
      await db.pushSubscription.deleteMany({
        where: { endpoint: params.subscription.endpoint },
      })
    } else {
      console.error('[push] Failed to send push notification', err)
    }
  }
}

// ─── Provider-targeted helper ─────────────────────────────────────────────────

export async function notifyProviderPush(params: {
  providerId: string
  title: string
  body: string
  url?: string
}): Promise<void> {
  const subs = await db.pushSubscription.findMany({
    where: { providerId: params.providerId },
  })

  if (subs.length === 0) return

  await Promise.all(
    subs.map((sub) =>
      sendPushNotification({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        title: params.title,
        body: params.body,
        url: params.url,
      })
    )
  )
}
