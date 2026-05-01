'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { getSafeNextPath } from '@/lib/safe-redirect'
import { phoneExistsForSignIn } from '@/lib/auth-phone-check'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function TechnicianSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = getSafeNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/technician',
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const normalized = normalizeOtpPhoneNumber(phone, 'ZA')
    if (!normalized.ok) {
      setError('Please enter a valid South African mobile number.')
      setLoading(false)
      return
    }

    try {
      const exists = await phoneExistsForSignIn(normalized.e164, 'provider')
      if (!exists) {
        setError("We couldn't find an active provider account for this number. Apply via WhatsApp first, or check the number.")
        return
      }

      const supabase = getSupabaseClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: normalized.e164 })

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
        `/technician-verify?phone=${encodeURIComponent(normalized.e164)}&next=${encodeURIComponent(next)}`,
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
        <p className="app-kicker">Worker Portal</p>
        <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter the mobile number linked to your provider account
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-foreground">Mobile number</Label>
          <SaMobileNumberInput
            id="phone"
            value={phone}
            onChange={setPhone}
            disabled={loading}
            onEdit={() => setError(null)}
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
