'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SaMobileNumberInput } from '@/components/shared/SaMobileNumberInput'
import { SA_OTP_SIGN_IN_HELPER_TEXT } from '@/lib/auth-example-phone'
import { getSafeCustomerNextPath, getSafeProviderNextPath } from '@/lib/safe-redirect'
import { normalizeOtpPhoneNumber, type OtpCountryCode } from '@/lib/phone-normalization'

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

type ApiSendCodeError = Partial<SendCodeError> & {
  code?: string
  reason?: string
}

type ApiSendCodePayload = {
  ok?: boolean
  nextStep?: string
  phone?: string
  code?: string
  message?: string
  traceId?: string
  error?: ApiSendCodeError
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
    case 400:
      return 'UNSUPPORTED_COUNTRY_CODE'
    case 401:
      return 'OTP_PROVIDER_AUTH_FAILED'
    case 403:
      return 'WORKER_NOT_APPROVED'
    case 423:
      return 'WORKER_INACTIVE'
    case 404:
      return 'WORKER_NOT_FOUND'
    case 422:
      return 'INVALID_MOBILE_NUMBER'
    case 429:
      return 'RATE_LIMITED'
    case 502:
      return 'AUTH_RESPONSE_INVALID'
    case 503:
      return 'AUTH_CONFIG_MISSING'
    case 504:
      return 'OTP_PROVIDER_TIMEOUT'
    default:
      return 'AUTH_RESPONSE_INVALID'
  }
}

function fallbackReasonForCode(code: string) {
  switch (code) {
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return "We couldn't find a provider account for this number. If you're trying to view your customer bookings, sign in as a customer instead."
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return 'Your provider application must be approved before you can sign in to the Provider portal.'
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 'This provider account is not active.'
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
      return 'Enter a valid South African mobile number.'
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Only South African mobile numbers are enabled for worker portal OTP sign-in.'
    case 'OTP_PROVIDER_AUTH_FAILED':
    case 'AUTH_CONFIG_MISSING':
      return "We couldn't send the code right now. Please try again shortly."
    case 'OTP_PROVIDER_BAD_RESPONSE':
    case 'AUTH_RESPONSE_INVALID':
      return "We couldn't send the code right now. Please try again shortly."
    case 'OTP_PROVIDER_TIMEOUT':
      return 'OTP delivery timed out.'
    case 'OTP_PROVIDER_UNAVAILABLE':
      return "We couldn't send the code right now. Please try again shortly."
    case 'OTP_DELIVERY_FAILED':
      return "We couldn't send the code right now. Please try again shortly."
    case 'RATE_LIMITED':
      return 'Too many login code requests were made. Please wait a few minutes and try again.'
    default:
      return 'The sign-in service did not return a usable response.'
  }
}

function titleForCode(code: string) {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Check the mobile number.'
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return 'Provider account not found.'
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return 'Application still under review.'
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 'Provider account inactive.'
    case 'RATE_LIMITED':
      return 'Please wait before trying again.'
    default:
      return "We couldn't send your login code."
  }
}

function toneForCode(code: string): SendCodeError['tone'] {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
    case 'UNSUPPORTED_COUNTRY_CODE':
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
    case 'RATE_LIMITED':
      return 'info'
    default:
      return 'error'
  }
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

  function localError(params: {
    reason: string
    code: string
    traceId: string
    mobileChecked?: string
    phoneMasked?: string
    countryCode?: string
  }): SendCodeError {
    return {
      title: titleForCode(params.code),
      reason: params.reason,
      code: params.code,
      step: 'Worker portal send-code',
      traceId: params.traceId,
      time: new Date().toISOString(),
      tone: toneForCode(params.code),
      mobileChecked: params.mobileChecked,
      phoneMasked: params.phoneMasked,
      countryCode: params.countryCode,
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
        traceId,
        countryCode: normalized.countryCode,
      }))
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/provider/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ phone, countryCode, traceId }),
      })
      const payload = await response.json().catch(() => ({})) as ApiSendCodePayload

      if (!response.ok || !payload.ok || !payload.phone) {
        const fallbackCode = fallbackCodeForStatus(response.status)
        const errorCode = payload.error?.code ?? payload.code ?? fallbackCode
        setError({
          title: payload.error?.title ?? titleForCode(errorCode),
          reason: payload.error?.reason ?? payload.message ?? fallbackReasonForCode(errorCode),
          code: errorCode,
          step: payload.error?.step ?? 'Worker portal send-code',
          traceId: payload.error?.traceId ?? payload.traceId ?? traceId,
          time: payload.error?.time ?? new Date().toISOString(),
          tone: toneForCode(errorCode),
          mobileChecked: payload.error?.mobileChecked,
          phoneMasked: payload.error?.phoneMasked ?? formatPhoneForDisplay(normalized.e164),
          countryCode: payload.error?.countryCode ?? countryCode,
          providerId: payload.error?.providerId,
        })
        return
      }

      router.push(
        `/provider-verify?phone=${encodeURIComponent(payload.phone)}&next=${encodeURIComponent(next)}`,
      )
    } catch {
      setError(localError({
        reason: 'The browser could not reach the sign-in service. Please try again or contact support with this screenshot.',
        code: 'OTP_PROVIDER_UNAVAILABLE',
        traceId,
        phoneMasked: formatPhoneForDisplay(normalized.e164),
        countryCode,
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1 text-center">
        <p className="app-kicker">Provider portal</p>
        <h1 className="text-2xl font-semibold text-foreground">Provider sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use the mobile number linked to your approved Plug-A-Pro provider profile.
        </p>
        <p className="text-xs text-muted-foreground">
          Customers should use customer sign in to view bookings, quotes, and job updates.
        </p>
      </div>

      {roleMismatchRecovery && !error && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground">
          <p className="font-medium">This account is signed in as a customer.</p>
          <p className="text-xs text-warning-foreground/80">
            Provider sign in is for approved providers only. Use customer sign in if you were trying to view bookings or quotes.
          </p>
          <Button asChild size="sm" className="mt-2 w-full">
            <Link href={customerSignInHref}>Sign in as customer</Link>
          </Button>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-foreground">Mobile number</Label>
          <SaMobileNumberInput
            id="phone"
            value={phone}
            onChange={setPhone}
            disabled={loading}
            onEdit={() => {
              if (error?.code === 'INVALID_PHONE_NUMBER' || error?.code === 'INVALID_MOBILE_NUMBER') setError(null)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {SA_OTP_SIGN_IN_HELPER_TEXT}
          </p>
        </div>

        {error && (
          <div className={`rounded-md border p-3 text-sm space-y-2 ${
            error.tone === 'info'
              ? 'tone-warning'
              : 'border-destructive/30 bg-destructive/5 text-destructive'
          }`}>
            <p className="font-medium">{error.title}</p>
            <p>{error.reason}</p>
            {(showProviderNotFoundRecovery || roleMismatchRecovery) && (
              <div className="grid gap-2 pt-1">
                <Button asChild size="sm" className="w-full">
                  <Link href={customerSignInHref}>Sign in as customer</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <a href={applyProviderHref}>Apply as provider on WhatsApp</a>
                </Button>
                <Button asChild size="sm" variant="ghost" className="w-full">
                  <a href={supportHref}>Contact support</a>
                </Button>
              </div>
            )}
            <details className="pt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium">Show technical details</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {error.code ? <><dt>Code</dt><dd className="text-right font-medium">{error.code}</dd></> : null}
                {error.step ? <><dt>Step</dt><dd className="text-right font-medium">{error.step}</dd></> : null}
                {error.mobileChecked ? <><dt>Mobile checked</dt><dd className="text-right font-medium">{error.mobileChecked}</dd></> : null}
                {error.countryCode ? <><dt>Country</dt><dd className="text-right font-medium">{error.countryCode}</dd></> : null}
                <dt>Trace ID</dt><dd className="text-right font-medium">{error.traceId}</dd>
                {error.time ? <><dt>Time</dt><dd className="text-right font-medium">{error.time}</dd></> : null}
              </dl>
            </details>
          </div>
        )}

        <Button type="submit" size="lg" disabled={loading || !phone} className="w-full">
          {loading ? 'Sending code…' : 'Send code'}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Not approved yet? Apply via WhatsApp:
        {' '}
        <a href={applyProviderHref} className="font-medium text-primary underline-offset-4 hover:underline">
          Send &quot;Register&quot;
        </a>
      </p>

      <p className="text-center text-xs text-muted-foreground">
        Are you trying to view customer bookings?{' '}
        <Link href={customerSignInHref} className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in as customer
        </Link>
        .
      </p>
    </div>
  )
}
