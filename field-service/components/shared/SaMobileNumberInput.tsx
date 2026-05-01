'use client'

import { Input } from '@/components/ui/input'
import { SA_EXAMPLE_MOBILE_LOCAL_SPACED } from '@/lib/auth-example-phone'

type SaMobileNumberInputProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Called when the user edits the field, before onChange — use to clear stale errors. */
  onEdit?: () => void
}

/**
 * South African OTP phone number input.
 *
 * Renders a fixed 🇿🇦 +27 country-code pill alongside a local-number text field.
 * The parent component owns the value string and handles normalization
 * (use normalizeOtpPhoneNumber from lib/phone-normalization).
 */
export function SaMobileNumberInput({
  id = 'phone',
  value,
  onChange,
  disabled = false,
  onEdit,
}: SaMobileNumberInputProps) {
  return (
    <div className="flex overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
      <select
        aria-label="Country code"
        value="ZA"
        disabled
        className="h-11 w-[96px] shrink-0 border-0 border-r border-input bg-muted px-3 text-sm font-medium text-foreground outline-none disabled:opacity-100"
      >
        <option value="ZA">🇿🇦 +27</option>
      </select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        placeholder={SA_EXAMPLE_MOBILE_LOCAL_SPACED}
        value={value}
        onChange={(e) => {
          onEdit?.()
          onChange(e.target.value)
        }}
        required
        disabled={disabled}
        className="h-11 flex-1 rounded-none border-0 bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
      />
    </div>
  )
}
