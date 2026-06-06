'use client'

import { useFormContext } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function ReferencesSection() {
  const { register, formState: { errors } } = useFormContext<{ references?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">References</legend>
      <div>
        <Label htmlFor="references">Professional references</Label>
        <Textarea
          id="references"
          rows={3}
          placeholder="Name, relationship, phone number — one per line"
          {...register('references')}
        />
        {errors.references && <p className="mt-1 text-xs text-destructive">{String(errors.references.message)}</p>}
      </div>
    </fieldset>
  )
}
