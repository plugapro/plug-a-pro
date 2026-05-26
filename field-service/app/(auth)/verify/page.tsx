'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { OtpInput } from '@/components/ui/otp-input'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/shared/auth-shell'
import { getOtpVerifyErrorMessage } from '@/lib/auth-client-errors'
import { createCustomerOtpClient } from '@/lib/supabase-auth-client'
import { getCustomerOtpSendErrorMessage } from '@/lib/auth-client-errors'
import { getSafeCustomerNextPath } from '@/lib/safe-redirect'
import { CUSTOMER_OTP_VERIFY_STORAGE_KEY, loadOtpVerifyState, saveOtpVerifyState } from '@/lib/otp-verify-state'
import { WA_ENABLED } from '@/lib/whatsapp-client'

function formatPhoneForDisplay(e164: string) {
  const digits = e164.replace(/\D/g, '')
  if (!digits.startsWith('27') || digits.length !== 11) return e164
  return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`
}

function buildCustomerVerifyHref(state: { phone: string; next?: string; name?: string; intent?: string }) {
  const params = new URLSearchParams({ phone: state.phone })
  if (state.next) params.set('next', state.next)
  if (state.name) params.set('name', state.name)
  if (state.intent) params.set('intent', state.intent)
  return `/verify?${params.toString()}`
}

type SessionGatePayload = {
  error?: string
  locked?: boolean
  code?: string
  stepUpRequired?: boolean
  redirectTo?: string
}

function WhatsAppIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      className="size-4" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

function VerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const phone = searchParams.get('phone') ?? ''
  const name = searchParams.get('name') ?? ''
  const intent = searchParams.get('intent') ?? ''
  const next = getSafeCustomerNextPath(
    searchParams.get('next') ?? searchParams.get('callbackUrl'),
    '/bookings',
  )

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submitRef = useRef(false)

  const COOLDOWN_KEY = 'pap:otp:resend_until'
  function getPersistedCooldown() {
    try {
      const until = Number(sessionStorage.getItem(COOLDOWN_KEY) ?? '0')
      return Math.max(0, Math.ceil((until - Date.now()) / 1000))
    } catch { return 0 }
  }
  const [resendCooldown, setResendCooldown] = useState(() => {
    const persisted = getPersistedCooldown()
    if (persisted > 0) return persisted
    try { return sessionStorage.getItem(COOLDOWN_KEY) !== null ? 0 : 30 } catch { return 30 }
  })

  useEffect(() => {
    if (phone) {
      saveOtpVerifyState(sessionStorage, CUSTOMER_OTP_VERIFY_STORAGE_KEY, {
        phone, next, name: name || undefined, intent: intent || undefined, savedAt: Date.now(),
      })
      return
    }
    const restored = loadOtpVerifyState(sessionStorage, CUSTOMER_OTP_VERIFY_STORAGE_KEY)
    if (restored) { router.replace(buildCustomerVerifyHref(restored)); return }
    router.replace('/sign-in')
  }, [phone, next, name, intent, router])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

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
      const supabase = createCustomerOtpClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone, token: code.trim(), type: 'sms',
      })

      if (verifyError || !data.user) {
        setError(getOtpVerifyErrorMessage(verifyError?.message))
        void fetch('/api/security/otp/verify-failed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneE164: phone }),
        }).catch(() => undefined)
        if (verifyError) {
          console.error('[verify] OTP verification error:', verifyError.message)
        } else {
          console.error('[verify] OTP verification returned no user without error')
        }
        return
      }

      if (!data.session?.access_token) {
        setError('We could not complete sign in. Please request a new code.')
        return
      }

      const sessionResponse = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.session.access_token, expiresIn: data.session.expires_in ?? 3600 }),
      })
      const sessionPayload = await sessionResponse.json().catch(() => ({})) as SessionGatePayload

      if (sessionPayload.stepUpRequired && sessionPayload.redirectTo) {
        setDone(true)
        router.replace(sessionPayload.redirectTo)
        return
      }

      if (!sessionResponse.ok || sessionPayload.locked) {
        setError(
          sessionPayload.locked
            ? 'We could not complete sign in securely. Please request a new code.'
            : sessionPayload.error ?? 'We could not complete sign in. Please request a new code.',
        )
        return
      }

      window.dispatchEvent(new Event('pap:auth-session-changed'))

      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name || undefined }),
      })

      let destination = next
      if (res.ok) {
        const json = await res.json() as { customerId?: string; isNew?: boolean; isProvider?: boolean }
        if (json.isProvider) {
          setError('This phone is already registered as a service provider. To manage your bookings as a customer, please contact support@plugapro.co.za.')
          return
        }
        if (intent === 'signup' || json.isNew) destination = '/services'
      } else {
        console.warn('[verify] linkCustomerAccount failed:', await res.text())
      }

      setDone(true)
      router.replace(destination)
    } catch (error) {
      console.error('[verify] unexpected OTP verify failure:', error)
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    const supabase = createCustomerOtpClient()
    const { error: resendError } = await supabase.auth.signInWithOtp({ phone })
    if (resendError) {
      setError(getCustomerOtpSendErrorMessage(resendError.message))
      console.error('[verify] OTP resend error:', resendError.message)
      return
    }
    try { sessionStorage.setItem(COOLDOWN_KEY, String(Date.now() + 30_000)) } catch { /* ignore */ }
    setResendCooldown(30)
  }

  const waHref = WA_ENABLED ? 'whatsapp://' : undefined

  if (!phone) return <p className="text-sm text-[var(--ink-mute)] text-center">Restoring sign in…</p>
  if (done) return <p className="text-sm text-[var(--ink-mute)] text-center">Redirecting…</p>

  return (
    <AuthShell
      eyebrow="Verify"
      title="Enter the 6-digit code"
      subtitle={
        <>Sent to <b className="text-[var(--ink)]">{formatPhoneForDisplay(phone)}</b>{WA_ENABLED ? ' via WhatsApp' : ''}.</>
      }
      backHref="/sign-in"
    >
      <div className="flex flex-col gap-[18px]">
        <OtpInput
          value={otp}
          onChange={(next) => { setError(null); setOtp(next) }}
          disabled={loading}
        />

        {error && (
          <div className="flex items-center justify-center gap-2 text-[13px] text-[var(--danger)] font-medium">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {loading && (
          <p className="text-[13px] text-[var(--ink-mute)] text-center">Verifying…</p>
        )}

        <p className="text-[13px] text-[var(--ink-mute)] text-center">
          {resendCooldown > 0 ? (
            <>Resend code in{' '}
              <span className="text-[var(--ink)] font-semibold font-mono">
                0:{resendCooldown.toString().padStart(2, '0')}
              </span>
            </>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              className="text-[var(--brand-purple)] font-semibold outline-none focus-visible:underline"
            >
              Resend code
            </button>
          )}
        </p>

        <Button
          type="button"
          fullWidth
          variant={otp.length === 6 && !loading ? 'default' : 'secondary'}
          disabled={otp.length !== 6 || loading}
          onClick={() => otp.length === 6 && handleVerifyOtp(otp)}
          size="md"
        >
          Verify &amp; continue
        </Button>

        {waHref && (
          <a
            href={waHref}
            className="md:hidden flex items-center justify-center gap-2 h-11 text-[13.5px] font-semibold text-[#1FAD52] outline-none focus-visible:underline"
          >
            <WhatsAppIcon />
            Switch to WhatsApp to read the code
          </a>
        )}
      </div>

      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => router.replace('/sign-in')}
          className="text-[13px] text-[var(--ink-mute)] outline-none focus-visible:underline"
        >
          ← Use a different number
        </button>
      </div>
    </AuthShell>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  )
}
