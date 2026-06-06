'use client'

import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RatesSection() {
  const { register, formState: { errors } } = useFormContext<{ hourlyRate?: number }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Rates</legend>
      <div>
        <Label htmlFor="hourlyRate">Hourly rate</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">R</span>
          <Input
            id="hourlyRate"
            type="number"
            inputMode="numeric"
            className="pl-7"
            placeholder="250"
            {...register('hourlyRate', { valueAsNumber: true })}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">/ hr</span>
        </div>
        {errors.hourlyRate && <p className="mt-1 text-xs text-destructive">{String(errors.hourlyRate.message)}</p>}
      </div>
    </fieldset>
  )
}
