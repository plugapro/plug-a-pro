'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { AuthShell } from '@/components/shared/auth-shell'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { getSafeCustomerNextPath } from '@/lib/safe-redirect'
import { CUSTOMER_OTP_VERIFY_STORAGE_KEY, saveOtpVerifyState } from '@/lib/otp-verify-state'

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

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState(prefillPhone)
  const [email, setEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const name = `${firstName.trim()} ${lastName.trim()}`.trim()
  const canSubmit = !loading && !!phone && name.length >= 2 && agreed

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (name.length < 2) {
      setError('Please enter your first and last name.')
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
        if (msg.includes('rate') || msg.includes('limit')) {
          setError('Too many attempts. Please wait a few minutes and try again.')
        } else if (msg.includes('invalid') || msg.includes('format')) {
          setError('Invalid phone number format. Please use your full South African number.')
        } else if (
          msg.includes('otp_whatsapp_disabled') || msg.includes('template_not_approved') ||
          msg.includes('wa_auth_failed') || msg.includes('wa_transient') ||
          msg.includes('unsupported') || msg.includes('provider') ||
          msg.includes('not enabled') || msg.includes('phone')
        ) {
          setError("We couldn't deliver your code on WhatsApp. Check the number and try again or contact support@plugapro.co.za.")
        } else {
          console.error('[sign-up] Supabase OTP error:', otpError.message)
          setError('Could not send code. Please try again or contact support@plugapro.co.za.')
        }
        return
      }

      const params = new URLSearchParams({
        phone: normalized.e164,
        name: name,
        intent: 'signup',
        next: prefillNext,
      })
      saveOtpVerifyState(sessionStorage, CUSTOMER_OTP_VERIFY_STORAGE_KEY, {
        phone: normalized.e164,
        name: name,
        intent: 'signup',
        next: prefillNext,
        savedAt: Date.now(),
      })
      router.push(`/verify?${params.toString()}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      backHref="/sign-in"
      eyebrow="New here"
      title="Create your account"
      subtitle="Takes about 30 seconds. We'll text you when a provider accepts your request."
      dense
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="firstName" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
              First name
            </label>
            <Input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); setError(null) }}
              placeholder="Thandi"
              disabled={loading}
              autoComplete="given-name"
              required
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
              Last name
            </label>
            <Input
              id="lastName"
              type="text"
              value={lastName}
              onChange={(e) => { setLastName(e.target.value); setError(null) }}
              placeholder="Mahlangu"
              disabled={loading}
              autoComplete="family-name"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="phone" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
            Mobile number
          </label>
          <SaMobileNumberInput
            id="phone"
            value={phone}
            onChange={setPhone}
            disabled={loading}
            onEdit={() => setError(null)}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor="email" className="text-[13px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
              Email
            </label>
            <span className="text-[12px] text-[var(--ink-mute)]">Optional</span>
          </div>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.co.za"
            disabled={loading}
            autoComplete="email"
          />
        </div>

        <button
          type="button"
          onClick={() => setAgreed((a) => !a)}
          className="flex gap-2.5 items-start text-left bg-transparent border-none cursor-pointer px-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)] rounded-lg"
        >
          <div
            className={[
              'flex items-center justify-center w-5 h-5 rounded-[6px] shrink-0 mt-0.5',
              'transition-[background,box-shadow] duration-150',
              agreed
                ? 'brand-gradient text-white'
                : 'bg-card shadow-[inset_0_0_0_1.5px_var(--border-strong)]',
            ].join(' ')}
            aria-hidden
          >
            {agreed && (
              <svg width="13" height="10" viewBox="0 0 13 10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1.5,5.5 5,9 11.5,1" />
              </svg>
            )}
          </div>
          <span className="text-[13px] leading-relaxed text-[var(--ink-mute)]">
            I agree to the{' '}
            <Link href="/terms" className="text-[var(--brand-purple)] font-semibold" onClick={(e) => e.stopPropagation()}>
              Terms
            </Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-[var(--brand-purple)] font-semibold" onClick={(e) => e.stopPropagation()}>
              Privacy Policy
            </Link>
            . My phone number is only shared with a provider after I accept their quote.
          </span>
        </button>

        {error && (
          <p className="text-[13px] text-[var(--danger)] text-center">{error}</p>
        )}

        <Button
          type="submit"
          fullWidth
          variant={canSubmit ? 'default' : 'secondary'}
          disabled={!canSubmit}
          size="md"
        >
          {loading ? 'Sending code…' : 'Create account'}
          {!loading && <ArrowRight size={18} />}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-[var(--ink-mute)]">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-[var(--brand-purple)] font-semibold">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
