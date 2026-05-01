'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SA_EXAMPLE_MOBILE_E164_SPACED, SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { getSafeNextPath } from '@/lib/safe-redirect'
import { phoneExistsForSignIn } from '@/lib/auth-phone-check'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function ProviderSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = getSafeNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/technician',
  )

  function normalise(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('27')) return `+${digits}`
    if (digits.startsWith('0') && digits.length === 10) return `+27${digits.slice(1)}`
    return `+${digits}`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const normalised = normalise(phone)
    if (!/^\+\d{10,15}$/.test(normalised)) {
      setError('Please enter a valid South African mobile number.')
      setLoading(false)
      return
    }

    try {
      const exists = await phoneExistsForSignIn(normalised, 'provider')
      if (!exists) {
        setError("We couldn't find an active provider account for this number. Apply via WhatsApp first, or check the number.")
        return
      }

      const supabase = getSupabaseClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: normalised })

      if (otpError) {
        const msg = otpError.message.toLowerCase()
        if (msg.includes('unsupported') || msg.includes('provider') || msg.includes('sms') || msg.includes('not enabled') || msg.includes('phone')) {
          setError('SMS login is temporarily unavailable. Please contact support@plugapro.co.za.')
        } else if (msg.includes('rate') || msg.includes('limit')) {
          setError('Too many attempts. Please wait a few minutes and try again.')
        } else {
          console.error('[technician-sign-in] Supabase OTP error:', otpError.message)
          setError('Could not send code. Please try again or contact support@plugapro.co.za.')
        }
        return
      }

      router.push(
        `/technician-verify?phone=${encodeURIComponent(normalised)}&next=${encodeURIComponent(next)}`,
      )
    } catch {
      setError('Something went wrong. Please try again.')
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
            placeholder={SA_EXAMPLE_MOBILE_E164_SPACED}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            disabled={loading}
            className="h-11 bg-background border-input text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/20"
          />
          <p className="text-xs text-muted-foreground">
            {SA_OTP_SIGN_IN_HELPER_TEXT}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
