'use client'

// TODO: replace with LocationNode-backed selects in follow-on PR
import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ServiceAreasSection() {
  const { register, formState: { errors } } = useFormContext<{ regionLabel?: string; cityLabel?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Service areas</legend>
      <div>
        <Label htmlFor="regionLabel">Region / province</Label>
        <Input id="regionLabel" {...register('regionLabel')} placeholder="e.g. Gauteng" />
        {errors.regionLabel && <p className="mt-1 text-xs text-destructive">{String(errors.regionLabel.message)}</p>}
      </div>
      <div>
        <Label htmlFor="cityLabel">City</Label>
        <Input id="cityLabel" {...register('cityLabel')} placeholder="e.g. Johannesburg" />
        {errors.cityLabel && <p className="mt-1 text-xs text-destructive">{String(errors.cityLabel.message)}</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        {"We're live in the West Rand first — your profile is saved and will be activated the moment we go live in your area."}
      </p>
    </fieldset>
  )
}
