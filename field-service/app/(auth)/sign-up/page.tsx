'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { getSafeCustomerNextPath } from '@/lib/safe-redirect'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export default function SignUpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const prefillPhone = searchParams.get('phone') ?? ''
  const prefillNext = getSafeCustomerNextPath(searchParams.get('next'), '/services')
  const [phone, setPhone] = useState(prefillPhone)
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !loading && !!phone && name.trim().length >= 2 && agreed

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (name.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).')
      return
    }
    if (!agreed) {
      setError('Please accept the Terms of Service and Privacy Policy to continue.')
      return
    }

    const normalized = normalizeOtpPhoneNumber(phone, 'ZA')
    if (!normalized.ok) {
      setError('Please enter a valid South African mobile number.')
      return
    }

    setLoading(true)
    try {
      const supabase = getSupabaseClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: normalized.e164 })

      if (otpError) {
        const msg = otpError.message.toLowerCase()
        if (msg.includes('unsupported') || msg.includes('provider') || msg.includes('sms') || msg.includes('not enabled') || msg.includes('phone')) {
          setError('SMS login is temporarily unavailable. Please contact support@plugapro.co.za.')
        } else if (msg.includes('rate') || msg.includes('limit')) {
          setError('Too many attempts. Please wait a few minutes and try again.')
        } else if (msg.includes('invalid') || msg.includes('format')) {
          setError('Invalid phone number format. Please use your full South African number.')
        } else {
          console.error('[sign-up] Supabase OTP error:', otpError.message)
          setError('Could not send code. Please try again or contact support@plugapro.co.za.')
        }
        return
      }

      const params = new URLSearchParams({
        phone: normalized.e164,
        name: name.trim(),
        intent: 'signup',
        next: prefillNext,
      })
      router.push(`/verify?${params.toString()}`)
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
        <h1 className="text-2xl font-semibold text-foreground">Create your account</h1>
        <p className="text-sm text-muted-foreground">We'll match you to nearby service providers</p>
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

        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-foreground">Full name</Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="Your full name"
            disabled={loading}
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
          />
        </div>

        <div className="flex items-start gap-2 pt-1">
          <Checkbox
            id="terms"
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            disabled={loading}
          />
          <Label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
            I agree to the{' '}
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>
            {' '}and{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
          </Label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
          {loading ? 'Sending code…' : 'Send code'}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in →
        </Link>
      </p>
    </div>
  )
}
