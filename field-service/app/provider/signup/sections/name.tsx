'use client'

import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function NameSection() {
  const { register, formState: { errors } } = useFormContext<{ name?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Your name</legend>
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" {...register('name')} autoComplete="name" />
        {errors.name && <p className="mt-1 text-xs text-destructive">{String(errors.name.message)}</p>}
      </div>
    </fieldset>
  )
}
