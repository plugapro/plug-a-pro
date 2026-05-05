'use client'

import { useEffect, useRef } from 'react'
import type { PayfastCheckoutPayload } from '@/lib/payfast'

interface PayfastCheckoutForwarderProps {
  checkout: PayfastCheckoutPayload
}

/**
 * Submits a hidden POST form to the Payfast checkout URL immediately on mount.
 * The browser navigates away from the app — show a loading message while it happens.
 */
export function PayfastCheckoutForwarder({ checkout }: PayfastCheckoutForwarderProps) {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    // Small delay so the loading message renders before the browser leaves.
    const timer = setTimeout(() => {
      formRef.current?.submit()
    }, 80)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="space-y-2 rounded-xl border bg-card p-6 text-center">
      <p className="font-medium">Redirecting to Payfast…</p>
      <p className="text-sm text-muted-foreground">
        You will be taken to the secure Payfast payment page. Please do not close this tab.
      </p>
      <form ref={formRef} method="POST" action={checkout.action} className="hidden">
        {Object.entries(checkout.fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </form>
    </div>
  )
}
