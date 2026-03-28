'use client'

// ─── Provider OTP verification ────────────────────────────────────────────────
// After OTP verification, checks that the Supabase user has role=provider.
// Providers are provisioned by admin (not self-serve) — if no provider role,
// the session is rejected and the user is directed to apply via WhatsApp.

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function ProviderVerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const phone = searchParams.get('phone') ?? ''

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(30)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = getSupabaseClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: otp.trim(),
        type: 'sms',
      })

      if (verifyError || !data.user) {
        setError(verifyError?.message ?? 'Invalid or expired code.')
        return
      }

      const role = data.user.user_metadata?.role
      if (role !== 'provider') {
        await supabase.auth.signOut()
        setError(
          "Your account isn't active yet. Once your application is approved, you'll receive a WhatsApp notification."
        )
        return
      }

      if (data.session?.access_token) {
        const maxAge = data.session.expires_in ?? 3600
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`
      }

      router.replace('/technician')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    const supabase = getSupabaseClient()
    await supabase.auth.signInWithOtp({ phone })
    setResendCooldown(30)
  }

  if (!phone) {
    router.replace('/technician-sign-in')
    return null
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <p className="text-xs font-semibold tracking-widest uppercase text-zinc-500">
          Worker Portal
        </p>
        <h1 className="text-2xl font-semibold text-white">Enter your code</h1>
        <p className="text-sm text-zinc-400">
          Sent to <span className="text-white font-medium">{phone}</span>
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleVerify} className="space-y-4">
        <Input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123456"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
          disabled={loading}
          className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 text-3xl tracking-widest text-center h-16 focus-visible:border-zinc-500 focus-visible:ring-zinc-500/20"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button
          type="submit"
          size="lg"
          disabled={loading || otp.length < 6}
          className="w-full"
        >
          {loading ? 'Verifying…' : 'Confirm'}
        </Button>
      </form>

      {/* Resend */}
      <div className="text-center">
        <button
          onClick={handleResend}
          disabled={resendCooldown > 0}
          className="text-sm text-zinc-400 hover:text-white disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors"
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
