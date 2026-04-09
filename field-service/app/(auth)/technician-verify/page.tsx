'use client'

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
        await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            expiresIn: data.session.expires_in ?? 3600,
          }),
        })
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
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1 text-center">
        <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
          Worker Portal
        </p>
        <h1 className="text-2xl font-semibold text-foreground">Enter your code</h1>
        <p className="text-sm text-muted-foreground">
          Sent to <span className="font-medium text-foreground">{phone}</span>
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
          className="h-16 bg-background border-input text-foreground placeholder:text-muted-foreground text-3xl tracking-widest text-center focus-visible:border-ring focus-visible:ring-ring/20"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" size="lg" disabled={loading || otp.length < 6} className="w-full">
          {loading ? 'Verifying…' : 'Confirm'}
        </Button>
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
