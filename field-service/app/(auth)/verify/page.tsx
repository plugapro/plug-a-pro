'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { OtpInput } from '@/components/ui/otp-input'
import { getOtpVerifyErrorMessage } from '@/lib/auth-client-errors'
import { getSafeNextPath } from '@/lib/safe-redirect'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function VerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const phone = searchParams.get('phone') ?? ''
  const next = getSafeNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/bookings',
  )

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

    try {
      const supabase = getSupabaseClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: code.trim(),
        type: 'sms',
      })

      if (verifyError || !data.user) {
        setError(getOtpVerifyErrorMessage(verifyError?.message))
        return
      }

      if (data.session?.access_token) {
        // Set the session as an HttpOnly cookie via the server — prevents JS/XSS from reading it
        await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            expiresIn: data.session.expires_in ?? 3600,
          }),
        })
      }

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // userId omitted — server reads it from the verified session cookie
        body: JSON.stringify({ phone }),
      })

      if (!res.ok) {
        console.warn('[verify] linkCustomerAccount failed:', await res.text())
      }

      // Mark as done before navigating so the form does not reappear while the
      // client-side navigation is still in progress (router.replace is non-blocking).
      setDone(true)
      router.replace(next)
    } catch {
      setError('Something went wrong. Please try again.')
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
    const supabase = getSupabaseClient()
    await supabase.auth.signInWithOtp({ phone })
    setResendCooldown(30)
  }

  if (!phone) {
    router.replace('/sign-in')
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
        <p className="app-kicker">Customer Access</p>
        <h1 className="text-2xl font-semibold text-foreground">Enter your code</h1>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to{' '}
          <span className="font-medium text-foreground">{phone}</span>
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleVerify} className="space-y-4">
        <OtpInput value={otp} onChange={setOtp} disabled={loading} />

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        {loading && (
          <p className="text-sm text-muted-foreground text-center">Verifying…</p>
        )}
      </form>

      {/* Resend + back */}
      <div className="space-y-3 text-center">
        <button
          onClick={handleResend}
          disabled={resendCooldown > 0}
          className="text-sm text-muted-foreground hover:text-foreground disabled:text-muted-foreground/50 disabled:cursor-not-allowed transition-colors"
        >
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
        </button>
        <div>
          <button
            onClick={() => router.replace('/sign-in')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Use a different number
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  )
}
