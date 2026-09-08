'use client'

// VodapayBootstrap — loads the hylid-bridge script that VodaPay injects into
// its mini-program WebView, detects whether we're actually running inside
// VodaPay (vs. someone hitting /vodapay directly in a normal browser),
// records the channel server-side via POST /api/channel (see
// app/api/channel/route.ts), then hands off into the normal customer home.
// VodaPay mode from that point on is carried entirely by the pap_channel
// cookie — no separate VodaPay-specific routes.
import Script from 'next/script'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { detectMiniProgram, HYLID_BRIDGE_SRC } from '@/lib/vodapay/bridge'

export function VodapayBootstrap() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!ready) return
    const inMiniProgram = detectMiniProgram(navigator.userAgent, window.my)
    void fetch('/api/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'vodapay' }),
    })
      .catch(() => undefined)
      .finally(() => {
        // Enter the normal home; VodaPay mode is carried by the cookie.
        router.replace(inMiniProgram ? '/' : '/?src=vodapay-preview')
      })
  }, [ready, router])

  return (
    <>
      <Script src={HYLID_BRIDGE_SRC} strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setReady(true)} />
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Opening Plug A Pro…</p>
      </main>
    </>
  )
}
