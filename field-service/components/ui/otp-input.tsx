'use client'

import { useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  length?: number
}

export function OtpInput({ value, onChange, disabled, length = 6 }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = value.padEnd(length, '').split('').slice(0, length)

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    onChange(next.join('').trimEnd())
    if (digit && index < length - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[index]) {
        const next = [...digits]
        next[index] = ''
        onChange(next.join('').trimEnd())
      } else if (index > 0) {
        const next = [...digits]
        next[index - 1] = ''
        onChange(next.join('').trimEnd())
        refs.current[index - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    onChange(pasted)
    const focusIndex = Math.min(pasted.length, length - 1)
    refs.current[focusIndex]?.focus()
  }

  return (
    <div className="flex gap-2 justify-center" role="group" aria-label="One-time code">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          autoFocus={i === 0}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${length}`}
          className={cn(
            'w-11 h-14 rounded-xl border border-input/90 bg-card/80',
            'text-center text-2xl font-semibold text-foreground',
            'shadow-[0_1px_2px_rgba(15,23,42,0.05)] outline-none',
            'transition-[color,box-shadow,border-color,background-color]',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:pointer-events-none disabled:opacity-50',
            digits[i] && 'border-ring/60',
          )}
        />
      ))}
    </div>
  )
}
