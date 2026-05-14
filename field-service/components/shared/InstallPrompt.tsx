'use client'

import { useEffect, useState } from 'react'
import { X, Download } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'pwa-install-dismissed'

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari uses this non-standard property
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    ) {
      return
    }

    if (sessionStorage.getItem(DISMISSED_KEY)) return

    function handler(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
      setVisible(false)
    }
  }

  function handleDismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Add Plug A Pro to your home screen"
      className="fixed bottom-[80px] left-4 right-4 z-50 rounded-[20px] flex items-center gap-4 px-4 py-4"
      style={{
        background: 'var(--ink)',
        color: 'var(--card)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}
    >
      {/* Icon */}
      <div
        className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
        style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
        aria-hidden
      >
        <Download size={20} color="white" />
      </div>

      {/* Copy */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] leading-tight">Add to home screen</p>
        <p className="text-[12px] opacity-70 leading-tight mt-0.5">Get faster access to your bookings</p>
      </div>

      {/* Install CTA */}
      <button
        onClick={handleInstall}
        className="shrink-0 h-9 px-4 rounded-[10px] text-[13px] font-semibold"
        style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)', color: '#fff' }}
        aria-label="Install app"
      >
        Install
      </button>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center opacity-60 hover:opacity-100"
        style={{ background: 'rgba(255,255,255,0.12)' }}
        aria-label="Dismiss install prompt"
      >
        <X size={14} color="white" />
      </button>
    </div>
  )
}
