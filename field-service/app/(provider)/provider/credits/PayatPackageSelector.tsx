'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { ExternalLink, Loader2, MessageCircle, QrCode } from 'lucide-react'
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

function whatsAppShareUrl(paymentLink: string) {
  // WhatsApp sharing opens with the Pay@ link ready for the provider to send.
  const message = `Tap here to pay for your Plug-A-Pro wallet top-up: ${paymentLink}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
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
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Pay@ payment ready</p>
              <p className="text-xs text-muted-foreground">
                Reference {result.reference.slice(-8).toUpperCase()} · {result.creditsToIssue} credits
              </p>
            </div>
            <QrCode className="size-5 text-primary" aria-hidden="true" />
          </div>
          <Image
            src={result.qrCodeUrl}
            alt="Pay@ QR code"
            width={224}
            height={224}
            unoptimized
            className="mx-auto aspect-square w-full max-w-56 rounded-md border bg-white object-contain p-3"
          />
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
        </div>
      </div>
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
