'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

export function ArrivalSubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" className="w-full" disabled={disabled || pending}>
      {pending ? 'Saving...' : 'Confirm Arrival Time'}
    </Button>
  )
}
