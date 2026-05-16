'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'react-qr-code'
import { CheckCircle2, ExternalLink, Loader2, MessageCircle, QrCode, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PROVIDER_CREDIT_PRICE_CENTS } from '@/lib/provider-wallet'
import {
  createProviderPayatTopUpIntent,
  type ProviderPayatTopUpResult,
} from './actions'

const TOP_UP_AMOUNTS_CENTS = [10_000, 20_000, 50_000] as const
const TOP_UP_OPTIONS = TOP_UP_AMOUNTS_CENTS.map((amountCents) => ({
  amountCents,
  label: `R${amountCents / 100}`,
  credits: amountCents / PROVIDER_CREDIT_PRICE_CENTS,
}))

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 10 * 60 * 1000
const TERMINAL_STATUSES = new Set(['CREDITED', 'FAILED', 'EXPIRED'])

function whatsAppShareUrl(paymentLink: string) {
  const message = `Tap here to pay for your Plug A Pro wallet top-up: ${paymentLink}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

function PaymentScreen({
  result,
  onReset,
}: {
  result: ProviderPayatTopUpResult
  onReset: () => void
}) {
  const router = useRouter()
  const [paymentStatus, setPaymentStatus] = useState<string>('PENDING_PAYMENT')
  const [timedOut, setTimedOut] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/provider/payment-intent/${result.intentId}/status`)
        if (!res.ok) return
        const data = (await res.json()) as { status: string }
        setPaymentStatus(data.status)
        if (TERMINAL_STATUSES.has(data.status)) {
          clearInterval(intervalRef.current!)
          clearTimeout(timeoutRef.current!)
          if (data.status === 'CREDITED') router.refresh()
        }
      } catch {
        // network hiccup — retry on next tick
      }
    }, POLL_INTERVAL_MS)

    // Timeout is set once per mount — not reset on each poll cycle.
    timeoutRef.current = setTimeout(() => {
      clearInterval(intervalRef.current!)
      setTimedOut(true)
    }, POLL_TIMEOUT_MS)

    return () => {
      clearInterval(intervalRef.current!)
      clearTimeout(timeoutRef.current!)
    }
  }, [result.intentId, router])

  if (paymentStatus === 'CREDITED') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border bg-background p-6 text-center">
        <CheckCircle2 className="size-10 text-green-500" aria-hidden="true" />
        <div>
          <p className="font-semibold">Credits added to your wallet</p>
          <p className="text-sm text-muted-foreground">
            {result.creditsToIssue} credits · R{result.amountCents / 100}
          </p>
        </div>
        <Button onClick={onReset} variant="outline" size="sm">
          Top up again
        </Button>
      </div>
    )
  }

  if (paymentStatus === 'FAILED') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <XCircle className="size-10 text-destructive" aria-hidden="true" />
        <div>
          <p className="font-semibold">Payment could not be confirmed</p>
          <p className="text-sm text-muted-foreground">
            Contact support if funds were deducted.
          </p>
        </div>
        <Button onClick={onReset} variant="outline" size="sm">
          Try again
        </Button>
      </div>
    )
  }

  if (paymentStatus === 'EXPIRED') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border bg-background p-6 text-center">
        <XCircle className="size-10 text-[var(--ink-mute,theme(colors.muted.foreground))]" aria-hidden="true" />
        <div>
          <p className="font-semibold">Payment link expired</p>
          <p className="text-sm text-muted-foreground">
            This Pay@ link is no longer valid. Start a new top-up.
          </p>
        </div>
        <Button onClick={onReset} variant="outline" size="sm">
          Start new payment
        </Button>
      </div>
    )
  }

  if (timedOut) {
    return (
      <div className="space-y-4 rounded-lg border bg-background p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Taking longer than expected. Check your WhatsApp or try again.
        </p>
        <Button onClick={onReset} variant="outline" size="sm">
          Start new payment
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Pay@ payment ready</p>
            <p className="text-xs text-muted-foreground">
              Ref {result.reference.slice(-8).toUpperCase()} · {result.creditsToIssue} credits
            </p>
          </div>
          <QrCode className="size-5 text-primary" aria-hidden="true" />
        </div>

        <div className="flex justify-center rounded-md border bg-white p-3">
          <QRCode value={result.paymentLink} size={200} />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Scan at Pick n Pay, Shoprite, or Checkers to pay cash
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Button asChild>
            <a href={result.paymentLink} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" aria-hidden="true" />
              Pay now
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={whatsAppShareUrl(result.paymentLink)} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" aria-hidden="true" />
              WhatsApp
            </a>
          </Button>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Waiting for payment confirmation…
        </div>
      </div>
    </div>
  )
}

export function PayatPackageSelector() {
  const [result, setResult] = useState<ProviderPayatTopUpResult | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSelect(amountCents: number) {
    setError(null)
    setSelectedAmount(amountCents)
    startTransition(async () => {
      try {
        const payat = await createProviderPayatTopUpIntent(amountCents)
        setResult(payat)
      } catch {
        setSelectedAmount(null)
        setError('Could not start Pay@ checkout. Please try again.')
      }
    })
  }

  if (result) {
    return (
      <PaymentScreen
        result={result}
        onReset={() => {
          setResult(null)
          setSelectedAmount(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {TOP_UP_OPTIONS.map((option) => {
          const isLoading = isPending && selectedAmount === option.amountCents
          return (
            <button
              key={option.amountCents}
              type="button"
              onClick={() => handleSelect(option.amountCents)}
              disabled={isPending}
              className="flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {option.credits} Plug A Pro provider credits
                </span>
              </span>
              <span className="flex items-center gap-2 text-sm font-medium">
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : 'Create Pay@ link'}
              </span>
            </button>
          )
        })}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
