'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActionFormContext } from './ActionForm'

type ButtonProps = React.ComponentProps<typeof Button>

interface SubmitButtonProps extends ButtonProps {
  pendingLabel?: string
  loading?: boolean
}

export function SubmitButton({
  children,
  pendingLabel,
  loading = false,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus()
  const { isPending: formPending } = useActionFormContext()
  const isWorking = loading || pending || formPending

  const label = isWorking
    ? (pendingLabel ?? (children ? `${children}…` : 'Working…'))
    : children

  return (
    <Button {...props} disabled={disabled || isWorking}>
      {isWorking && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  )
}
