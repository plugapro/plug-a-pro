'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSafeNextPath } from '@/lib/safe-redirect'
import { normalizePhone } from '@/lib/utils'

type SendCodeError = {
  title: string
  reason: string
  code: string
  step: string
  traceId: string
  time: string
  phoneMasked?: string
  providerId?: string
}

export default function ProviderSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<SendCodeError | null>(null)
  const next = getSafeNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/provider',
  )

  function localError(reason: string, code: string): SendCodeError {
    return {
      title: "We couldn't send your login code.",
      reason,
      code,
      step: 'Worker portal send-code',
      traceId: `client_${Date.now().toString(36)}`,
      time: new Date().toISOString(),
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const normalised = normalizePhone(phone)
    if (!/^\+\d{10,15}$/.test(normalised)) {
      setError(localError('The mobile number format is invalid. Use a South African mobile number such as 0823035070.', 'INVALID_PHONE_NUMBER'))
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/provider/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalised }),
      })
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean
        phone?: string
        error?: SendCodeError
      }

      if (!response.ok || !payload.ok || !payload.phone) {
        setError(payload.error ?? localError('The sign-in service did not return a usable response.', 'UNKNOWN_AUTH_ERROR'))
        return
      }

      router.push(
        `/provider-verify?phone=${encodeURIComponent(payload.phone)}&next=${encodeURIComponent(next)}`,
      )
    } catch {
      setError(localError('The browser could not reach the sign-in service. Please try again or contact support with this screenshot.', 'UNKNOWN_AUTH_ERROR'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1 text-center">
        <p className="app-kicker">
          Worker Portal
        </p>
        <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter the mobile number linked to your provider account
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-foreground">Mobile number</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            placeholder="+27 82 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            disabled={loading}
            className="h-11 bg-background border-input text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20"
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
            <p className="font-medium">{error.title}</p>
            <p>{error.reason}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-destructive/90">
              <dt>Error code</dt><dd className="text-right font-medium">{error.code}</dd>
              {error.phoneMasked && <><dt>Mobile checked</dt><dd className="text-right font-medium">{error.phoneMasked}</dd></>}
              {error.providerId && <><dt>Provider ID</dt><dd className="text-right font-medium">{error.providerId}</dd></>}
              <dt>Step</dt><dd className="text-right font-medium">{error.step}</dd>
              <dt>Trace ID</dt><dd className="text-right font-medium">{error.traceId}</dd>
              <dt>Time</dt><dd className="text-right font-medium">{error.time}</dd>
            </dl>
          </div>
        )}

        <Button type="submit" size="lg" disabled={loading || !phone} className="w-full">
          {loading ? 'Sending code…' : 'Send code'}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Not registered yet? Apply via WhatsApp — send &quot;Register&quot; to our business number.
      </p>
    </div>
  )
}
