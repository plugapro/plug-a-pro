'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { OtpInput } from '@/components/ui/otp-input'
import { Button } from '@/components/ui/button'
import { getSafeCustomerNextPath, getSafeProviderNextPath } from '@/lib/safe-redirect'

function formatPhoneForDisplay(e164: string) {
  const digits = e164.replace(/\D/g, '')
  if (!digits.startsWith('27') || digits.length !== 11) return '*** *** ****'
  return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`
}

function createClientTraceId() {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

type VerifyError = {
  message: string
  traceId: string
  code?: string
}

type VerifyCodePayload = {
  ok?: boolean
  code?: string
  message?: string
  traceId?: string
  error?: {
    code?: string
    reason?: string
    traceId?: string
  }
}

function messageForCode(code: string | undefined) {
  switch (code) {
    case 'INVALID_OTP':
    case 'OTP_EXPIRED':
    case 'OTP_PROVIDER_REJECTED':
      return 'That code is incorrect or expired. Please try again.'
    case 'WORKER_NOT_APPROVED':
      return "Your provider application is still under review. We'll notify you on WhatsApp once it has been approved."
    case 'WORKER_INACTIVE':
      return 'This provider account is not active. Please contact support.'
    case 'WORKER_NOT_FOUND':
      return "We couldn't find a provider account for this number. Please apply first or contact support."
    case 'WORKER_PROFILE_LINK_MISSING':
    case 'WORKER_AUTH_IDENTITY_MISSING':
    case 'WORKER_ROLE_MISSING':
    case 'AUTH_SESSION_MISSING':
      return 'Your provider login could not be linked automatically. Please contact support.'
    case 'DUPLICATE_WORKER_PROFILE':
      return 'We found more than one provider account for this login. Please contact support.'
    default:
      return 'Something went wrong. Please try again or contact support.'
  }
}

function ProviderVerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const phone = searchParams.get('phone') ?? ''
  const next = getSafeProviderNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/provider/jobs',
  )
  const requestedNext = searchParams.get('next') ?? searchParams.get('callbackUrl')
  const customerSignInHref = `/sign-in?next=${encodeURIComponent(
    getSafeCustomerNextPath(requestedNext, '/bookings'),
  )}`

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<VerifyError | null>(null)
  const [resendCooldown, setResendCooldown] = useState(30)
  const [done, setDone] = useState(false)
  const submitRef = useRef(false)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (otp.length === 6 && !loading && !submitRef.current) {
      submitRef.current = true
      handleVerifyOtp(otp)
    }
    if (otp.length < 6) submitRef.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp])

  async function handleVerifyOtp(code: string) {
    setError(null)
    setLoading(true)
    const traceId = createClientTraceId()

    try {
      const response = await fetch('/api/auth/provider/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ phone, code: code.trim(), traceId }),
      })
      const payload = await response.json().catch(() => ({})) as VerifyCodePayload

      if (!response.ok || !payload.ok) {
        const errorCode = payload.error?.code ?? payload.code
        setError({
          message: payload.error?.reason ?? payload.message ?? messageForCode(errorCode),
          traceId: payload.error?.traceId ?? payload.traceId ?? traceId,
          code: errorCode,
        })
        return
      }

      // Mark as done before navigating so the form does not reappear while the
      // client-side navigation is still in progress.
      setDone(true)
      router.replace(next)
    } catch {
      setError({ message: 'Something went wrong. Please try again.', traceId })
    } finally {
      setLoading(false)
    }
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (otp.length === 6) handleVerifyOtp(otp)
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    const traceId = createClientTraceId()
    try {
      const response = await fetch('/api/auth/provider/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ phone, traceId }),
      })
      const payload = await response.json().catch(() => ({})) as VerifyCodePayload
      if (!response.ok || !payload.ok) {
        setError({
          message: payload.error?.reason ?? payload.message ?? 'Could not resend code. Please try again.',
          traceId: payload.error?.traceId ?? payload.traceId ?? traceId,
        })
        return
      }
      setResendCooldown(30)
    } catch {
      setError({ message: 'Could not resend code. Please try again.', traceId })
    }
  }

  if (!phone) {
    router.replace('/provider-sign-in')
    return null
  }

  if (done) {
    return (
      <p className="text-sm text-muted-foreground text-center">Redirecting…</p>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1 text-center">
        <p className="app-kicker">Provider Portal</p>
        <h1 className="text-2xl font-semibold text-foreground">Enter your code</h1>
        <p className="text-sm text-muted-foreground">
          Code sent on WhatsApp to <span className="font-medium text-foreground">{formatPhoneForDisplay(phone)}</span>
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleVerify} className="space-y-4">
        <OtpInput value={otp} onChange={(next) => { setError(null); setOtp(next) }} disabled={loading} />

        {error && (
          <div className="space-y-1 text-center">
            <p className="text-sm text-destructive">{error.message}</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Show technical details</summary>
              <p className="mt-1">Trace ID: {error.traceId}</p>
            </details>
            {(error.code === 'WORKER_NOT_FOUND' || error.code === 'PROVIDER_NOT_FOUND') && (
              <div className="pt-2">
                <p className="mb-2 text-xs text-muted-foreground">
                  If this is a customer account, open the customer sign-in flow:
                </p>
                <Button asChild size="sm" className="w-full">
                  <Link href={customerSignInHref}>
                    Sign in as customer
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground text-center">Verifying…</p>
        )}
      </form>

      {/* Resend */}
      <div className="text-center">
        <button
          onClick={handleResend}
          disabled={resendCooldown > 0}
          className="text-sm text-muted-foreground hover:text-foreground disabled:text-muted-foreground/50 disabled:cursor-not-allowed transition-colors"
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
        </button>
      </div>
    </div>
  )
}

export default function ProviderVerifyPage() {
  return (
    <Suspense fallback={null}>
      <ProviderVerifyForm />
    </Suspense>
  )
}
