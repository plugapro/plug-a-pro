'use client'

import type React from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

type LeadActionSubmitButtonProps = {
  children: React.ReactNode
  pendingLabel: string
  className?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  disabled?: boolean
}

export function LeadActionSubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  size,
  disabled,
}: LeadActionSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || pending}
    >
      {pending ? pendingLabel : children}
    </Button>
  )
}
