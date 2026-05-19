'use client'

import type React from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

type FormSubmitButtonProps = {
  children: React.ReactNode
  /** Label shown alongside the spinner while the parent form is submitting. */
  pendingLabel: React.ReactNode
  className?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  fullWidth?: React.ComponentProps<typeof Button>['fullWidth']
  /** Caller-controlled disabled (e.g. validation failed). OR'd with form pending. */
  disabled?: boolean
}

/**
 * Drop-in submit button for any <form action={serverAction}>. Reads
 * useFormStatus() to set `loading` on the base Button so the user always
 * sees a spinner + label-swap while the action runs. Prevents double-clicks
 * on financial and other irreversible mutations.
 *
 * For non-form CTAs (onClick handlers calling startTransition), pass
 * `loading` directly to <Button> instead of using this wrapper.
 */
export function FormSubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  size,
  fullWidth,
  disabled,
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={className}
      disabled={disabled}
      loading={pending}
      loadingLabel={pendingLabel}
    >
      {children}
    </Button>
  )
}
