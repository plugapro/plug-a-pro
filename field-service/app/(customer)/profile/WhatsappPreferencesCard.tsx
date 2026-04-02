'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'

type Prefs = {
  whatsappServiceOptIn: boolean
  whatsappMarketingOptIn: boolean
  whatsappMarketingOptInAt: string | null
  whatsappMarketingOptOutAt: string | null
}

export function WhatsappPreferencesCard() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/customer/preferences')
      .then((r) => r.json())
      .then((d: Prefs) => setPrefs(d))
      .catch(() => {/* fail silently — non-critical */})
  }, [])

  async function toggle() {
    if (!prefs || saving) return
    setSaving(true)
    const next = !prefs.whatsappMarketingOptIn
    try {
      await fetch('/api/customer/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappMarketingOptIn: next }),
      })
      setPrefs((p) => p ? { ...p, whatsappMarketingOptIn: next } : p)
    } finally {
      setSaving(false)
    }
  }

  if (!prefs) return null

  return (
    <Card>
      <CardContent className="px-4 py-4">
        <h3 className="font-medium text-sm mb-1">WhatsApp Notifications</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Receive special offers and promotions via WhatsApp. Booking updates are always sent regardless of this setting.
        </p>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={prefs.whatsappMarketingOptIn}
            onChange={toggle}
            disabled={saving}
            className="h-4 w-4 rounded accent-primary"
          />
          <span className="text-sm">
            {prefs.whatsappMarketingOptIn ? 'Subscribed to offers' : 'Not subscribed to offers'}
          </span>
        </label>
      </CardContent>
    </Card>
  )
}
