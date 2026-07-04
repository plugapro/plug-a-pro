'use client'

import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CertificationSection() {
  const { register, formState: { errors } } = useFormContext<{ certificationRef?: string }>()

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Certification / registration</legend>
      <p className="text-sm text-muted-foreground">
        One or more of your selected trades requires a certification or registration number. Please provide your licence, registration, or qualification reference.
      </p>
      <div>
        <Label htmlFor="certificationRef">Certification or registration number</Label>
        <Input
          id="certificationRef"
          type="text"
          placeholder="e.g. WL-2024-001234"
          {...register('certificationRef')}
        />
        {errors.certificationRef && (
          <p className="mt-1 text-xs text-destructive">{String(errors.certificationRef.message)}</p>
        )}
      </div>
    </fieldset>
  )
}
