'use client'

import { PhoneInput } from '@/components/ui/phone-input'
import { SA_EXAMPLE_MOBILE_LOCAL_SPACED } from '@/lib/auth-example-phone'

type SaMobileNumberInputProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  onEdit?: () => void
}

export function SaMobileNumberInput({
  id = 'phone',
  value,
  onChange,
  disabled = false,
  onEdit,
}: SaMobileNumberInputProps) {
  return (
    <PhoneInput
      id={id}
      value={value}
      onChange={(v) => {
        onEdit?.()
        onChange(v)
      }}
      placeholder={SA_EXAMPLE_MOBILE_LOCAL_SPACED}
      disabled={disabled}
    />
  )
}
