'use client'

import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function IdentitySection() {
  const { register, formState: { errors } } = useFormContext<{ idNumber?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">SA ID number</legend>
      <p className="text-xs text-muted-foreground">If you have a passport or chose to verify later, you can skip this step in WhatsApp instead.</p>
      <div>
        <Label htmlFor="idNumber">13-digit SA ID</Label>
        <Input id="idNumber" {...register('idNumber')} inputMode="numeric" autoComplete="off" />
        {errors.idNumber && <p className="mt-1 text-xs text-destructive">{String(errors.idNumber.message)}</p>}
      </div>
    </fieldset>
  )
}
