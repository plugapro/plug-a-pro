'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { AuthShell } from '@/components/shared/auth-shell'
import { getSafeCustomerNextPath, getSafeProviderNextPath } from '@/lib/safe-redirect'
import { normalizeOtpPhoneNumber, type OtpCountryCode } from '@/lib/phone-normalization'
import { PROVIDER_OTP_VERIFY_STORAGE_KEY, saveOtpVerifyState } from '@/lib/otp-verify-state'
import { WA_ENABLED } from '@/lib/whatsapp-client'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'

type SendCodeError = {
  title: string
  reason: string
  code: string
  step: string
  traceId: string
  time: string
  tone: 'info' | 'error'
  mobileChecked?: string
  phoneMasked?: string
  countryCode?: string
  providerId?: string
}

type ApiSendCodeError = Partial<SendCodeError> & { code?: string; reason?: string }
type ApiSendCodePayload = {
  ok?: boolean; nextStep?: string; phone?: string; code?: string;
  message?: string; traceId?: string; error?: ApiSendCodeError
}

function createClientTraceId() {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function formatPhoneForDisplay(e164: string | undefined) {
  if (!e164) return undefined
  const digits = e164.replace(/\D/g, '')
  if (!digits.startsWith('27') || digits.length !== 11) return undefined
  return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`
}

function whatsappHref(message: string) {
  const configured = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER
  const digits = configured?.replace(/\D/g, '')
  if (!digits) return `mailto:support@plugapro.co.za?subject=${encodeURIComponent('Plug-A-Pro sign-in help')}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

function fallbackCodeForStatus(status: number) {
  switch (status) {
    case 400: return 'UNSUPPORTED_COUNTRY_CODE'
    case 401: return 'OTP_PROVIDER_AUTH_FAILED'
    case 403: return 'WORKER_NOT_APPROVED'
    case 423: return 'WORKER_INACTIVE'
    case 404: return 'WORKER_NOT_FOUND'
    case 422: return 'INVALID_MOBILE_NUMBER'
    case 429: return 'RATE_LIMITED'
    case 502: return 'AUTH_RESPONSE_INVALID'
    case 503: return 'AUTH_CONFIG_MISSING'
    case 504: return 'OTP_PROVIDER_TIMEOUT'
    default: return 'AUTH_RESPONSE_INVALID'
  }
}

function fallbackReasonForCode(code: string) {
  switch (code) {
    case 'WORKER_NOT_FOUND': case 'PROVIDER_NOT_FOUND':
      return "We couldn't find a provider account for this number. If you're trying to view your customer bookings, sign in as a customer instead."
    case 'WORKER_NOT_APPROVED': case 'PROVIDER_NOT_APPROVED':
      return 'Your provider application must be approved before you can sign in to the Provider portal.'
    case 'WORKER_INACTIVE': case 'PROVIDER_INACTIVE':
      return 'This provider account is not active.'
    case 'INVALID_MOBILE_NUMBER': case 'INVALID_PHONE_NUMBER':
      return 'Enter a valid South African mobile number.'
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Only South African mobile numbers are enabled for worker portal OTP sign-in.'
    case 'RATE_LIMITED':
      return 'Too many login code requests were made. Please wait a few minutes and try again.'
    default:
      return "We couldn't send the code right now. Please try again shortly."
  }
}

function titleForCode(code: string) {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER': case 'INVALID_PHONE_NUMBER': case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Check the mobile number.'
    case 'WORKER_NOT_FOUND': case 'PROVIDER_NOT_FOUND': return 'Provider account not found.'
    case 'WORKER_NOT_APPROVED': case 'PROVIDER_NOT_APPROVED': return 'Application still under review.'
    case 'WORKER_INACTIVE': case 'PROVIDER_INACTIVE': return 'Provider account inactive.'
    case 'RATE_LIMITED': return 'Please wait before trying again.'
    default: return "We couldn't send your login code."
  }
}

function toneForCode(code: string): SendCodeError['tone'] {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER': case 'INVALID_PHONE_NUMBER': case 'UNSUPPORTED_COUNTRY_CODE':
    case 'WORKER_NOT_FOUND': case 'PROVIDER_NOT_FOUND': case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED': case 'WORKER_INACTIVE': case 'PROVIDER_INACTIVE': case 'RATE_LIMITED':
      return 'info'
    default: return 'error'
  }
}

function WhatsAppIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      className="size-[18px]" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

export default function ProviderSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phone, setPhone] = useState('')
  const [countryCode] = useState<OtpCountryCode>('ZA')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<SendCodeError | null>(null)
  const requestedNext = searchParams.get('next') ?? searchParams.get('callbackUrl')
  const next = getSafeProviderNextPath(requestedNext, '/provider/jobs')
  const customerNext = getSafeCustomerNextPath(requestedNext, '/bookings')
  const customerSignInHref = `/sign-in?next=${encodeURIComponent(customerNext)}`
  const applyProviderHref = whatsappHref('Hi Plug A Pro, I would like to apply as a provider.')
  const supportHref = whatsappHref('Hi Plug A Pro, I need help signing in.')
  const showProviderNotFoundRecovery = error?.code === 'WORKER_NOT_FOUND' || error?.code === 'PROVIDER_NOT_FOUND'
  const roleMismatchRecovery = searchParams.get('error') === 'unauthorized'

  const isValidPhone = phone.replace(/\D/g, '').length >= 9

  function localError(params: {
    reason: string; code: string; traceId: string;
    mobileChecked?: string; phoneMasked?: string; countryCode?: string
  }): SendCodeError {
    return {
      title: titleForCode(params.code), reason: params.reason, code: params.code,
      step: 'Worker portal send-code', traceId: params.traceId,
      time: new Date().toISOString(), tone: toneForCode(params.code),
      mobileChecked: params.mobileChecked, phoneMasked: params.phoneMasked, countryCode: params.countryCode,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const traceId = createClientTraceId()
    const normalized = normalizeOtpPhoneNumber(phone, countryCode)
    if (!normalized.ok) {
      setError(localError({
        reason: normalized.reason,
        code: normalized.errorCode === 'INVALID_PHONE_NUMBER' ? 'INVALID_MOBILE_NUMBER' : normalized.errorCode,
        traceId, countryCode: normalized.countryCode,
      }))
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/provider/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-trace-id': traceId },
        body: JSON.stringify({ phone, countryCode, traceId }),
      })
      const payload = await response.json().catch(() => ({})) as ApiSendCodePayload

      if (!response.ok || !payload.ok || !payload.phone) {
        const fallbackCode = fallbackCodeForStatus(response.status)
        const errorCode = payload.error?.code ?? payload.code ?? fallbackCode
        setError({
          title: payload.error?.title ?? titleForCode(errorCode),
          reason: payload.error?.reason ?? payload.message ?? fallbackReasonForCode(errorCode),
          code: errorCode, step: payload.error?.step ?? 'Worker portal send-code',
          traceId: payload.error?.traceId ?? payload.traceId ?? traceId,
          time: payload.error?.time ?? new Date().toISOString(), tone: toneForCode(errorCode),
          mobileChecked: payload.error?.mobileChecked,
          phoneMasked: payload.error?.phoneMasked ?? formatPhoneForDisplay(normalized.e164),
          countryCode: payload.error?.countryCode ?? countryCode,
          providerId: payload.error?.providerId,
        })
        return
      }

      saveOtpVerifyState(sessionStorage, PROVIDER_OTP_VERIFY_STORAGE_KEY, {
        phone: payload.phone, next, savedAt: Date.now(),
      })
      router.push(`/provider-verify?phone=${encodeURIComponent(payload.phone)}&next=${encodeURIComponent(next)}`)
    } catch {
      setError(localError({
        reason: 'The browser could not reach the sign-in service. Please try again or contact support with this screenshot.',
        code: 'OTP_PROVIDER_UNAVAILABLE', traceId,
        phoneMasked: formatPhoneForDisplay(normalized.e164), countryCode,
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      backHref="/sign-in"
      eyebrow="Provider portal"
      title="Sign in to accept jobs"
      subtitle="Use the mobile number linked to your approved Plug A Pro provider profile."
    >
      {roleMismatchRecovery && !error && (
        <div className="mb-5 rounded-[16px] bg-[var(--tone-warning-bg)] border border-[var(--tone-warning-border)] p-4 text-sm">
          <p className="font-semibold text-[var(--tone-warning-fg)]">This account is signed in as a customer.</p>
          <p className="text-[12px] text-[var(--ink-mute)] mt-1">
            Provider sign in is for approved providers only. Use customer sign in if you were trying to view bookings or quotes.
          </p>
          <Button size="sm" fullWidth className="mt-3" asChild>
            <Link href={customerSignInHref}>Sign in as customer</Link>
          </Button>
        </div>
      )}

      {!roleMismatchRecovery && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
          <div>
            <label htmlFor="phone" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
              Provider mobile number
            </label>
            <SaMobileNumberInput
              id="phone"
              value={phone}
              onChange={setPhone}
              disabled={loading}
              onEdit={() => {
                if (error?.code === 'INVALID_PHONE_NUMBER' || error?.code === 'INVALID_MOBILE_NUMBER') setError(null)
              }}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-mute)]">
              {SA_OTP_SIGN_IN_HELPER_TEXT}
            </p>
          </div>

          {error && (
            <div className={[
              'rounded-[16px] border p-4 text-[13px] space-y-2',
              error.tone === 'info'
                ? 'bg-[var(--tone-warning-bg)] border-[var(--tone-warning-border)] text-[var(--tone-warning-fg)]'
                : 'bg-[var(--tone-danger-bg)] border-[var(--tone-danger-border)] text-[var(--tone-danger-fg)]',
            ].join(' ')}>
              <p className="font-semibold">{error.title}</p>
              <p className="text-[var(--ink-mute)]">{error.reason}</p>
              {showProviderNotFoundRecovery && (
                <div className="flex flex-col gap-2 pt-1">
                  <Button size="sm" fullWidth asChild><Link href={customerSignInHref}>Sign in as customer</Link></Button>
                  <Button size="sm" fullWidth variant="secondary" asChild><a href={applyProviderHref}>Apply as provider on WhatsApp</a></Button>
                  <Button size="sm" fullWidth variant="ghost" asChild><a href={supportHref}>Contact support</a></Button>
                </div>
              )}
              <details className="pt-1 text-[11px] text-[var(--ink-mute)]">
                <summary className="cursor-pointer font-medium">Show technical details</summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {error.code && <><dt>Code</dt><dd className="text-right font-medium font-mono">{error.code}</dd></>}
                  {error.step && <><dt>Step</dt><dd className="text-right font-medium">{error.step}</dd></>}
                  {error.mobileChecked && <><dt>Mobile</dt><dd className="text-right font-medium">{error.mobileChecked}</dd></>}
                  {error.countryCode && <><dt>Country</dt><dd className="text-right font-medium">{error.countryCode}</dd></>}
                  <dt>Trace ID</dt><dd className="text-right font-medium font-mono">{error.traceId}</dd>
                </dl>
              </details>
            </div>
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
        </form>
      )}

      {WA_ENABLED && !roleMismatchRecovery && (
        <div className="mt-5 rounded-[16px] bg-[rgba(37,211,102,0.06)] border border-[rgba(37,211,102,0.18)] p-4">
          <div className="flex gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-[#25D366] text-white shrink-0">
              <WhatsAppIcon />
            </div>
            <div>
              <p className="text-[14px] font-bold text-[var(--ink)] mb-0.5">Not approved yet?</p>
              <p className="text-[12.5px] text-[var(--ink-mute)] leading-relaxed">
                Send <b>Register</b> on WhatsApp to start your provider application.
              </p>
            </div>
          </div>
          <Button variant="whatsapp" fullWidth size="sm" className="mt-3" asChild>
            <a href={applyProviderHref} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon />
              Open WhatsApp · Send &quot;Register&quot;
            </a>
          </Button>
        </div>
      )}

      <p className="mt-6 text-center text-[13px] text-[var(--ink-mute)]">
        Looking for customer sign in?{' '}
        <Link href={customerSignInHref} className="text-[var(--brand-purple)] font-semibold">
          Tap here
        </Link>
      </p>
    </AuthShell>
  )
}
