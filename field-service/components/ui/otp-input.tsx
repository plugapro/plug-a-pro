'use client'

import { useEffect, useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  length?: number
}

export function normalizeOtpValue(raw: string, length = 6): string {
  return raw.replace(/\D/g, '').slice(0, length)
}

function otpDigits(value: string, length: number): string[] {
  const normalized = normalizeOtpValue(value, length)
  return Array.from({ length }, (_, index) => normalized[index] ?? '')
}

export function applyOtpInputChange(
  currentValue: string,
  index: number,
  rawInput: string,
  length = 6,
): { value: string; focusIndex: number } {
  const cleaned = normalizeOtpValue(rawInput, length)

  if (cleaned.length > 1) {
    return {
      value: cleaned,
      focusIndex: Math.min(cleaned.length, length) - 1,
    }
  }

  const next = otpDigits(currentValue, length)
  next[index] = cleaned
  return {
    value: next.join('').slice(0, length),
    focusIndex: cleaned && index < length - 1 ? index + 1 : index,
  }
}

export function applyOtpBackspace(
  currentValue: string,
  index: number,
  length = 6,
): { value: string; focusIndex: number } {
  const next = otpDigits(currentValue, length)
  if (next[index]) {
    next[index] = ''
    return { value: next.join('').slice(0, length), focusIndex: index }
  }

  if (index > 0) {
    next[index - 1] = ''
    return { value: next.join('').slice(0, length), focusIndex: index - 1 }
  }

  return { value: next.join('').slice(0, length), focusIndex: index }
}

export function OtpInput({ value, onChange, disabled, length = 6 }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = otpDigits(value, length)

  useEffect(() => {
    if (!disabled) refs.current[0]?.focus()
  }, [disabled])

  function handleChange(index: number, raw: string) {
    const next = applyOtpInputChange(value, index, raw, length)
    onChange(next.value)
    refs.current[next.focusIndex]?.focus()
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const next = applyOtpBackspace(value, index, length)
      onChange(next.value)
      refs.current[next.focusIndex]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = normalizeOtpValue(e.clipboardData.getData('text'), length)
    onChange(pasted)
    const focusIndex = pasted.length > 0 ? Math.min(pasted.length, length) - 1 : 0
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
          pattern="[0-9]*"
          maxLength={length}
          name={i === 0 ? 'one-time-code' : undefined}
          value={digits[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          autoFocus={i === 0}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          enterKeyHint="done"
          aria-label={`Digit ${i + 1} of ${length}`}
          className={cn(
            'w-11 h-14 rounded-[16px] bg-card outline-none',
            'text-center text-2xl font-semibold font-mono text-[var(--ink)]',
            'transition-[box-shadow,background-color] duration-150',
            digits[i]
              ? 'shadow-[inset_0_0_0_1.5px_var(--brand-purple)]'
              : 'shadow-[inset_0_0_0_1px_var(--border)]',
            'focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        />
      ))}
    </div>
  )
}
