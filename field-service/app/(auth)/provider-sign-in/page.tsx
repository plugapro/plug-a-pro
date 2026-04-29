'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSafeNextPath } from '@/lib/safe-redirect'
import { normalizeOtpPhoneNumber, type OtpCountryCode } from '@/lib/phone-normalization'

type SendCodeError = {
  title: string
  reason: string
  code: string
  step: string
  traceId: string
  time: string
  mobileChecked?: string
  phoneMasked?: string
  countryCode?: string
  providerId?: string
}

function createClientTraceId() {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function ProviderSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [countryCode] = useState<OtpCountryCode>('ZA')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<SendCodeError | null>(null)
  const next = getSafeNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/provider',
  )

  function localError(params: {
    reason: string
    code: string
    traceId: string
    mobileChecked?: string
    countryCode?: string
  }): SendCodeError {
    return {
      title: "We couldn't send your login code.",
      reason: params.reason,
      code: params.code,
      step: 'Worker portal send-code',
      traceId: params.traceId,
      time: new Date().toISOString(),
      mobileChecked: params.mobileChecked,
      countryCode: params.countryCode,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const traceId = createClientTraceId()
    const normalized = normalizeOtpPhoneNumber(phone, countryCode)
    if (!normalized.ok) {
      setError(localError({
        reason: normalized.reason,
        code: normalized.errorCode,
        traceId,
        countryCode: normalized.countryCode,
      }))
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/provider/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ phone, countryCode, traceId }),
      })
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean
        phone?: string
        error?: SendCodeError
      }

      if (!response.ok || !payload.ok || !payload.phone) {
        setError(payload.error ?? localError({
          reason: 'The sign-in service did not return a usable response.',
          code: 'UNKNOWN_AUTH_ERROR',
          traceId,
          mobileChecked: normalized.e164,
          countryCode,
        }))
        return
      }

      router.push(
        `/provider-verify?phone=${encodeURIComponent(payload.phone)}&next=${encodeURIComponent(next)}`,
      )
    } catch {
      setError(localError({
        reason: 'The browser could not reach the sign-in service. Please try again or contact support with this screenshot.',
        code: 'OTP_PROVIDER_UNAVAILABLE',
        traceId,
        mobileChecked: normalized.e164,
        countryCode,
      }))
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
          <div className="flex overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <select
              aria-label="Country code"
              value={countryCode}
              disabled
              className="h-11 w-[96px] shrink-0 border-0 border-r border-input bg-muted px-3 text-sm font-medium text-foreground outline-none disabled:opacity-100"
            >
              <option value="ZA">🇿🇦 +27</option>
            </select>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="82 303 5070"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                if (error?.code === 'INVALID_PHONE_NUMBER') setError(null)
              }}
              required
              disabled={loading}
              className="h-11 flex-1 rounded-none border-0 bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            South Africa is selected for OTP sign-in. You can enter 0823035070, 27823035070, or +27823035070.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
            <p className="font-medium">{error.title}</p>
            <p>{error.reason}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-destructive/90">
              <dt>Error code</dt><dd className="text-right font-medium">{error.code}</dd>
              {(error.mobileChecked || error.phoneMasked) && <><dt>Mobile checked</dt><dd className="text-right font-medium">{error.mobileChecked ?? error.phoneMasked}</dd></>}
              {error.countryCode && <><dt>Country</dt><dd className="text-right font-medium">{error.countryCode}</dd></>}
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
