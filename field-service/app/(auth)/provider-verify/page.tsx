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

function formatPhoneForDisplay(e164: string) {
  const digits = e164.replace(/\D/g, '')
  if (!digits.startsWith('27') || digits.length !== 11) return '*** *** ****'
  return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`
}

function ProviderVerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const phone = searchParams.get('phone') ?? ''
  const next = getSafeNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/provider',
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

      const role = data.user.user_metadata?.role
      if (role !== 'provider') {
        await supabase.auth.signOut()
        // Distinguish between a customer account and a truly unrecognised account so
        // the user knows what action to take instead of waiting for an approval that
        // may never come.
        if (role === 'customer') {
          setError(
            "This number is linked to a customer account. To become a service provider, please apply via WhatsApp — send \"Register\" to our business number."
          )
        } else {
          setError(
            "Your provider account hasn't been approved yet. Once your application is reviewed you'll receive a WhatsApp notification. If you haven't applied yet, send \"Register\" to our WhatsApp number."
          )
        }
        return
      }

      if (data.session?.access_token) {
        await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            expiresIn: data.session.expires_in ?? 3600,
          }),
        })
      }

      // Mark as done before navigating so the form does not reappear while the
      // client-side navigation is still in progress.
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
        <p className="app-kicker">
          Worker Portal
        </p>
        <h1 className="text-2xl font-semibold text-foreground">Enter your code</h1>
        <p className="text-sm text-muted-foreground">
          Code sent to <span className="font-medium text-foreground">{formatPhoneForDisplay(phone)}</span>
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleVerify} className="space-y-4">
        <OtpInput value={otp} onChange={(next) => { setError(null); setOtp(next) }} disabled={loading} />

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

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
