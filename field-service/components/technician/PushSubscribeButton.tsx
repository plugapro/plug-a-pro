'use client'

import { useEffect, useState } from 'react'

export function PushSubscribeButton() {
  const [state, setState] = useState<'idle' | 'subscribed' | 'unsupported' | 'denied'>('idle')

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    if (Notification.permission === 'granted') {
      setState('subscribed')
    }
  }, [])

  async function subscribe() {
    if (!('serviceWorker' in navigator)) return

    try {
      const reg = await navigator.serviceWorker.ready

      // Get VAPID public key from server
      const res = await fetch('/api/push')
      if (!res.ok) return
      const { publicKey } = await res.json()

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })

      setState('subscribed')
    } catch {
      // Permission denied or error
      if (Notification.permission === 'denied') setState('denied')
    }
  }

  if (state === 'unsupported' || state === 'subscribed') return null

  if (state === 'denied') {
    return (
      <p className="text-xs text-muted-foreground text-center px-4">
        Enable notifications in browser settings to receive job alerts.
      </p>
    )
  }

  return (
    <button
      onClick={subscribe}
      className="w-full rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground hover:bg-accent transition-colors"
    >
      Enable job notifications
    </button>
  )
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const buffer = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) buffer[i] = rawData.charCodeAt(i)
  return buffer.buffer as ArrayBuffer
}
