'use client'

import { useState, useTransition } from 'react'
import { CreditCard, Landmark, QrCode, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PayfastTopUpMethod } from '@/lib/provider-credit-payment-intents'
import { PayfastCheckoutForwarder } from '@/components/provider/PayfastCheckoutForwarder'
import { createProviderPayfastTopUpIntent, type ProviderPayfastCheckoutResult } from './actions'

const TOP_UP_OPTIONS = [
  { amountCents: 10_000, label: 'R100', credits: 5 },
  { amountCents: 20_000, label: 'R200', credits: 10 },
  { amountCents: 50_000, label: 'R500', credits: 25 },
] as const

const METHOD_OPTIONS: {
  value: PayfastTopUpMethod
  label: string
  description: string
  Icon: React.ElementType
}[] = [
  { value: 'PAYFAST_CARD', label: 'Card', description: 'Credit or debit card', Icon: CreditCard },
  { value: 'PAYFAST_EFT', label: 'Instant EFT', description: 'Pay via banking app', Icon: Landmark },
  { value: 'PAYFAST_SCODE', label: 'Scan to Pay', description: 'QR code / SnapScan', Icon: QrCode },
]

export function PayfastPackageSelector() {
  const [method, setMethod] = useState<PayfastTopUpMethod>('PAYFAST_CARD')
  const [result, setResult] = useState<ProviderPayfastCheckoutResult | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSelect(amountCents: number) {
    setError(null)
    setSelectedAmount(amountCents)
    startTransition(async () => {
      try {
        const checkout = await createProviderPayfastTopUpIntent(amountCents, method)
        setResult(checkout)
      } catch {
        setSelectedAmount(null)
        setError('Could not start checkout. Please try again.')
      }
    })
  }

  if (result) {
    return <PayfastCheckoutForwarder checkout={result.checkout} />
  }

  return (
    <div className="space-y-4">
      {/* Payment method tabs */}
      <div className="grid grid-cols-3 gap-2">
        {METHOD_OPTIONS.map(({ value, label, description, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setMethod(value)}
            disabled={isPending}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs transition-colors disabled:pointer-events-none',
              method === value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="font-medium leading-tight">{label}</span>
            <span className="hidden leading-tight text-[10px] sm:block">{description}</span>
          </button>
        ))}
      </div>

      {/* Package cards */}
      <div className="grid gap-2">
        {TOP_UP_OPTIONS.map((option) => {
          const isLoading = isPending && selectedAmount === option.amountCents
          return (
            <button
              key={option.amountCents}
              type="button"
              onClick={() => handleSelect(option.amountCents)}
              disabled={isPending}
              className="flex w-full items-center justify-between rounded-xl border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {option.credits} Plug-A-Pro Credits
                </span>
              </span>
              <span className="flex items-center gap-2 text-sm font-medium">
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Pay now'
                )}
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
