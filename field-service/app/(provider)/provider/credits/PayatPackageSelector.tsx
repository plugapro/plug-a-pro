'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PROVIDER_CREDIT_PRICE_CENTS } from '@/lib/provider-wallet'
import { createProviderPayatTopUpIntent } from './actions'

const TOP_UP_AMOUNTS_CENTS = [10_000, 20_000, 50_000] as const
const TOP_UP_OPTIONS = TOP_UP_AMOUNTS_CENTS.map((amountCents) => ({
  amountCents,
  label: `R${amountCents / 100}`,
  credits: amountCents / PROVIDER_CREDIT_PRICE_CENTS,
}))

export function PayatPackageSelector() {
  const router = useRouter()
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSelect(amountCents: number) {
    setError(null)
    setSelectedAmount(amountCents)
    startTransition(async () => {
      try {
        const response = await createProviderPayatTopUpIntent(amountCents)
        if (response.ok) {
          router.push(`/provider/credits/intent/${response.data.intentId}`)
          return
        }
        if (response.code === 'TOO_MANY_PENDING') {
          router.push('/provider/credits/limit')
          return
        }
        // Server action returned a structured failure - surface the specific
        // user message instead of the generic "try again" copy.
        console.error('[PayatPackageSelector] checkout_failed', { code: response.code })
        setSelectedAmount(null)
        setError(response.userMessage)
        toast.error(response.userMessage)
      } catch (err) {
        // Should be rare now (server action returns errors as values), but log
        // the raw error in case Next.js stripped a thrown one in production.
        console.error('[PayatPackageSelector] checkout_threw', err)
        setSelectedAmount(null)
        setError('We couldn’t create your Pay@ reference. Please try again.')
        toast.error('We couldn’t create your Pay@ reference. Please try again.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {TOP_UP_OPTIONS.map((option) => {
          const isLoading = isPending && selectedAmount === option.amountCents
          // rows that are not loading get dimmed while another is pending
          const isDisabledOther = isPending && !isLoading
          return (
            <button
              key={option.amountCents}
              type="button"
              onClick={() => handleSelect(option.amountCents)}
              disabled={isPending}
              className="flex w-full items-center justify-between rounded-[14px] px-4 py-3.5 text-left transition-opacity"
              style={{
                background: 'var(--card-alt)',
                boxShadow: 'inset 0 0 0 1px var(--border)',
                opacity: isDisabledOther ? 0.5 : 1,
                cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              <span className="flex flex-col gap-0.5">
                {/* Amount label */}
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                  {option.label}
                </span>
                {/* Credit count */}
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                  {option.credits} Plug A Pro credits
                </span>
              </span>
              {/* Right action label or spinner */}
              <span
                className="flex items-center gap-2"
                style={{ fontSize: 13, fontWeight: 600, color: '#8B3FE8' }}
              >
                {isLoading
                  ? <Loader2 className="size-4 animate-spin" style={{ color: '#8B3FE8' }} />
                  : 'Create Pay@ link'}
              </span>
            </button>
          )
        })}
      </div>

      {error ? (
        <p
          className="rounded-[12px] px-4 py-3"
          style={{
            fontSize: 12.5,
            color: '#EF4444',
            background: 'rgba(239,68,68,0.06)',
            boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.2)',
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
