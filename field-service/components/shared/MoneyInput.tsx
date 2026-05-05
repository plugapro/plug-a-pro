'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> {
  /** ISO currency code prefix shown to the left of the field. Default ZAR. */
  currency?: string
  /** Optional symbol override. Defaults to "R" for ZAR. */
  symbol?: string
}

/**
 * Currency input with a fixed prefix chip and a numeric keypad on mobile.
 * Strips non-digit characters except a single decimal point so we can
 * round to cents on the server.
 *
 * The visible value remains the raw input (no auto-formatting) to avoid
 * caret jumps on mobile keyboards. Format on display, parse on submit.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput(
    { currency = 'ZAR', symbol, className, onChange, ...props },
    ref,
  ) {
    const visibleSymbol = symbol ?? (currency === 'ZAR' ? 'R' : currency)

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const cleaned = e.target.value
        .replace(/[^\d.]/g, '')
        .replace(/(\..*)\./g, '$1') // collapse extra dots
      // Mutate input value so React stays in sync without re-rendering twice.
      e.target.value = cleaned
      onChange?.(e)
    }

    return (
      <div
        className={cn(
          'flex h-11 items-center gap-2 rounded-xl border border-input bg-card/70 px-3 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40',
          className,
        )}
      >
        <span
          aria-hidden
          className="text-sm font-semibold text-muted-foreground tabular-nums"
        >
          {visibleSymbol}
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          onChange={handleChange}
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-foreground tabular-nums placeholder:text-muted-foreground/70 focus:outline-none"
          {...props}
        />
      </div>
    )
  },
)
