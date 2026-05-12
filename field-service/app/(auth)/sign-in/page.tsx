'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { getSafeCustomerNextPath } from '@/lib/safe-redirect'
import { phoneExistsForSignIn } from '@/lib/auth-phone-check'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function SignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = getSafeCustomerNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/bookings',
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
      const exists = await phoneExistsForSignIn(normalized.e164, 'customer')
      if (!exists) {
        router.push(`/sign-up?phone=${encodeURIComponent(normalized.e164)}&next=${encodeURIComponent(next)}`)
        return
      }

      const supabase = getSupabaseClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: normalized.e164 })

      if (otpError) {
        const msg = otpError.message.toLowerCase()
        if (msg.includes('rate') || msg.includes('limit')) {
          setError('Too many attempts. Please wait a few minutes and try again.')
        } else if (msg.includes('invalid') || msg.includes('format')) {
          setError('Invalid phone number format. Please use your full South African number.')
        } else if (
          msg.includes('otp_whatsapp_disabled') ||
          msg.includes('template_not_approved') ||
          msg.includes('wa_auth_failed') ||
          msg.includes('wa_transient') ||
          msg.includes('unsupported') ||
          msg.includes('provider') ||
          msg.includes('not enabled') ||
          msg.includes('phone')
        ) {
          setError(
            "We couldn't deliver your code on WhatsApp. Check the number and try again, or contact support@plugapro.co.za.",
          )
        } else {
          console.error('[sign-in] Supabase OTP error:', otpError.message)
          setError('Could not send code. Please try again or contact support@plugapro.co.za.')
        }
        return
      }

      router.push(
        `/verify?phone=${encodeURIComponent(normalized.e164)}&next=${encodeURIComponent(next)}`,
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
        <p className="app-kicker">Customer Access</p>
        <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">Enter your number to receive a one-time code on WhatsApp</p>
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
        Your number is never shared. By continuing you agree to our terms.
      </p>

      <p className="text-center text-xs text-muted-foreground">
        Are you a provider?{' '}
        <Link href="/provider-sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
          Use provider sign in
        </Link>
        .
      </p>

      <p className="text-center text-xs text-muted-foreground">
        New to Plug A Pro?{' '}
        <Link href="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
          Create account →
        </Link>
      </p>
    </div>
  )
}
