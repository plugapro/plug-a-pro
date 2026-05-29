'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import QRCode from 'react-qr-code'
import { Copy, ExternalLink, Loader2, MessageCircle, QrCode, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { notifyProviderPayatTopUpInitiated } from '../../actions'

const POLL_INTERVAL_MS = 5_000
const POLL_REQUEST_TIMEOUT_MS = 4_000
const POLL_PAGE_TIMEOUT_MS = 10 * 60 * 1000
const TERMINAL_STATUSES = new Set(['CREDITED', 'FAILED', 'EXPIRED'])

type IntentPaymentClientProps = {
  intentId: string
  initialStatus: string
  amountCents: number
  creditsToIssue: number
  reference: string
  paymentLink: string | null
  expiresAt: string | null
}

type StatusResponse = {
  status: string
  creditsIssued?: number
  creditedAt?: string | null
}

function formatExpiry(value: string | null) {
  if (!value) return 'Valid for this Pay@ session'
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function IntentPaymentClient({
  intentId,
  initialStatus,
  amountCents,
  creditsToIssue,
  reference,
  paymentLink,
  expiresAt,
}: IntentPaymentClientProps) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [timedOut, setTimedOut] = useState(false)
  const [isSendingWhatsApp, startWhatsAppTransition] = useTransition()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    async function poll() {
      if (stoppedRef.current) return
      const startedAt = performance.now()
      const controller = new AbortController()
      const requestTimeout = setTimeout(() => controller.abort(), POLL_REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(`/api/provider/payment-intent/${intentId}/status`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) {
          console.warn('[payat] poll_non_ok', { intentId, status: res.status, elapsedMs: performance.now() - startedAt })
          return
        }
        const data = (await res.json()) as StatusResponse
        if (stoppedRef.current) return
        setStatus(data.status)
        console.info('[payat] poll_status', { intentId, status: data.status, elapsedMs: performance.now() - startedAt })
        if (TERMINAL_STATUSES.has(data.status)) {
          stoppedRef.current = true
          stopPolling()
          if (timeoutRef.current) clearTimeout(timeoutRef.current)
          if (data.status === 'CREDITED') {
            router.replace(`/provider/credits/success?intent=${intentId}&credits=${data.creditsIssued ?? creditsToIssue}`)
          }
          if (data.status === 'EXPIRED') {
            router.replace(`/provider/credits/intent/${intentId}?status=expired`)
          }
          if (data.status === 'FAILED') {
            toast.error('Payment could not be confirmed. Contact support if funds were deducted.')
            router.replace('/provider/credits?topup=failed')
          }
        }
      } catch (error) {
        const reason = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network'
        console.warn('[payat] poll_failed', { intentId, reason, elapsedMs: performance.now() - startedAt })
      } finally {
        clearTimeout(requestTimeout)
      }
    }

    function startPolling() {
      if (!intervalRef.current) intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling()
        return
      }
      void poll()
      startPolling()
    }

    if (!TERMINAL_STATUSES.has(initialStatus)) {
      void poll()
      startPolling()
      timeoutRef.current = setTimeout(() => {
        stoppedRef.current = true
        stopPolling()
        setTimedOut(true)
        console.warn('[payat] poll_page_timeout', { intentId, timeoutMs: POLL_PAGE_TIMEOUT_MS })
      }, POLL_PAGE_TIMEOUT_MS)
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      stopPolling()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [creditsToIssue, initialStatus, intentId, router])

  async function copyPaymentLink() {
    if (!paymentLink) return
    try {
      await navigator.clipboard.writeText(paymentLink)
      toast.success('Pay@ link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  function sendWhatsApp() {
    startWhatsAppTransition(async () => {
      const result = await notifyProviderPayatTopUpInitiated(intentId)
      if (result.ok) {
        toast.success('WhatsApp link sent')
        return
      }
      toast.error(result.message)
    })
  }

  if (status === 'EXPIRED') {
    return (
      <div className="min-h-screen px-[18px] pb-32 pt-[60px] screen-enter">
        <div className="rounded-[24px] p-5 text-center" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <XCircle className="mx-auto size-12" style={{ color: 'var(--ink-mute)' }} aria-hidden="true" />
          <h1 className="mt-4 text-[24px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>Pay@ link expired</h1>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--ink-mute)' }}>
            This payment link is no longer valid. Start a new top-up to get a fresh reference.
          </p>
          <Button asChild className="mt-5" fullWidth>
            <Link href="/provider/credits#topup">Start new top-up</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-[18px] pb-32 pt-[60px] screen-enter">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--ink-mute)' }}>Pay@ top-up</p>
          <h1 className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>Payment ready</h1>
        </div>
        <QrCode className="size-6" style={{ color: '#8B3FE8' }} aria-hidden="true" />
      </div>

      <div className="mt-5 rounded-[24px] p-4" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] break-all font-semibold" style={{ color: 'var(--ink)' }}>Ref {reference.slice(-8).toUpperCase()}</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-mute)' }}>
              R{amountCents / 100} = {creditsToIssue} credits
            </p>
          </div>
          <div className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: 'rgba(139,63,232,0.1)', color: '#8B3FE8' }}>
            {status.replace(/_/g, ' ')}
          </div>
        </div>

        <div className="mt-4 rounded-[18px] bg-white p-4 text-center" style={{ boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          {paymentLink ? <QRCode value={paymentLink} size={210} className="mx-auto" /> : null}
          <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-mute)' }}>
            Scan or open the link to pay at Shoprite, Pick n Pay, Checkers or any Pay@ supported channel.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Button asChild disabled={!paymentLink}>
            <a href={paymentLink ?? '#'} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              Pay now
            </a>
          </Button>
          <Button type="button" variant="whatsapp" onClick={sendWhatsApp} loading={isSendingWhatsApp} loadingLabel="Sending">
            <MessageCircle className="size-4" aria-hidden="true" />
            WhatsApp
          </Button>
        </div>

        <button
          type="button"
          onClick={copyPaymentLink}
          disabled={!paymentLink}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-left disabled:opacity-45"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Copy payment link</span>
            <span className="mt-0.5 block break-all text-[11px] leading-snug" style={{ color: 'var(--ink-mute)' }}>{paymentLink ?? 'Link is not available yet'}</span>
          </span>
          <Copy className="size-4 shrink-0" style={{ color: '#8B3FE8' }} aria-hidden="true" />
        </button>

        <div className="mt-4 flex items-center justify-center gap-2 text-[12px]" style={{ color: 'var(--ink-mute)' }}>
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {timedOut ? 'Still pending. Open pending payments to check later.' : 'Waiting for Pay@ confirmation'}
        </div>
        <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          Expires {formatExpiry(expiresAt)}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button asChild variant="secondary">
          <Link href="/provider/credits/pending">Pending</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/provider/credits">Wallet</Link>
        </Button>
      </div>
    </div>
  )
}
