'use client'

import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function IdentitySection() {
  const { register, formState: { errors } } = useFormContext<{ name?: string; idNumber?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Identity</legend>
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" {...register('name')} autoComplete="name" />
        {errors.name && <p className="mt-1 text-xs text-destructive">{String(errors.name.message)}</p>}
      </div>
      <div>
        <Label htmlFor="idNumber">SA ID number</Label>
        <Input id="idNumber" {...register('idNumber')} inputMode="numeric" autoComplete="off" />
        {errors.idNumber && <p className="mt-1 text-xs text-destructive">{String(errors.idNumber.message)}</p>}
      </div>
    </fieldset>
  )
}
