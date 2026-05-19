'use client'

import type React from 'react'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import type { Button } from '@/components/ui/button'

type LeadActionSubmitButtonProps = {
  children: React.ReactNode
  pendingLabel: string
  className?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  disabled?: boolean
}

/**
 * Backward-compatible wrapper kept so existing call sites don't need to be
 * touched. New code should use `<FormSubmitButton>` from
 * `@/components/ui/form-submit-button` directly.
 *
 * @deprecated Use FormSubmitButton from '@/components/ui/form-submit-button'
 * directly. This wrapper is retained only for backward compatibility with
 * call sites that imported it before the primitive moved into the ui/
 * directory. New code should import FormSubmitButton.
 */
export function LeadActionSubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  size,
  disabled,
}: LeadActionSubmitButtonProps) {
  return (
    <FormSubmitButton
      pendingLabel={pendingLabel}
      className={className}
      variant={variant}
      size={size}
      disabled={disabled}
    >
      {children}
    </FormSubmitButton>
  )
}
