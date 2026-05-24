'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { ArrowRight, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { AuthShell } from '@/components/shared/auth-shell'
import { getSafeCustomerNextPath } from '@/lib/safe-redirect'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { CUSTOMER_OTP_VERIFY_STORAGE_KEY, saveOtpVerifyState } from '@/lib/otp-verify-state'
import { WA_ENABLED } from '@/lib/whatsapp-client'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function WhatsAppIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      className="size-4" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
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

  const eyebrow = next.includes('/book/')
    ? 'Almost there'
    : next.includes('/bookings')
      ? 'See your bookings'
      : 'Sign in or get started'

  const subtitle = next.includes('/book/')
    ? "Sign in to submit your request. You'll get a written quote on WhatsApp before any work starts."
    : "Get a one-time code on WhatsApp. Your number is never shared with providers until you accept a quote."

  const isValidPhone = phone.replace(/\D/g, '').length >= 9

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
          setError("We couldn't deliver your code on WhatsApp. Check the number and try again, or contact support@plugapro.co.za.")
        } else {
          console.error('[sign-in] Supabase OTP error:', otpError.message)
          setError('Could not send code. Please try again or contact support@plugapro.co.za.')
        }
        return
      }

      saveOtpVerifyState(sessionStorage, CUSTOMER_OTP_VERIFY_STORAGE_KEY, {
        phone: normalized.e164,
        next,
        savedAt: Date.now(),
      })
      router.push(`/verify?phone=${encodeURIComponent(normalized.e164)}&next=${encodeURIComponent(next)}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={eyebrow}
      title="Sign in to Plug A Pro"
      subtitle={subtitle}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
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
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-mute)]">
            {SA_OTP_SIGN_IN_HELPER_TEXT}
          </p>
        </div>

        {WA_ENABLED && (
          <div className="flex items-center gap-2.5 bg-[rgba(37,211,102,0.08)] border border-[rgba(37,211,102,0.18)] rounded-[16px] p-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-[8px] bg-[#25D366] text-white shrink-0">
              <WhatsAppIcon />
            </div>
            <span className="text-[12.5px] text-[var(--ink)] leading-[1.35]">
              We&apos;ll send a 6-digit code via <b>WhatsApp</b>.
            </span>
          </div>
        )}

        {error && (
          <p className="text-[13px] text-[var(--danger)] text-center">{error}</p>
        )}

        <Button
          type="submit"
          fullWidth
          variant={isValidPhone && !loading ? 'default' : 'secondary'}
          disabled={!isValidPhone || loading}
          size="md"
        >
          {loading ? 'Sending code…' : 'Send code'}
          {!loading && <ArrowRight size={18} />}
        </Button>

        <p className="text-center text-[13px] text-[var(--ink-mute)]">
          New here?{' '}
          <Link href="/sign-up" className="text-[var(--brand-purple)] font-semibold">
            Create an account
          </Link>
        </p>
      </form>

      <div className="flex items-center gap-2.5 my-7">
        <div className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-[11px] text-[var(--ink-soft)] uppercase tracking-[0.06em]">or</span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>

      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" fullWidth size="md" asChild>
          <Link href="/provider-sign-in">
            <Wrench size={16} className="text-[var(--brand-purple)]" />
            I&apos;m a service provider
          </Link>
        </Button>
      </div>
    </AuthShell>
  )
}
