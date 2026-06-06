'use client'

import { useFormContext, useController } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function AvailabilitySection() {
  const { control, formState: { errors } } = useFormContext<{ availability?: string[] }>()
  const { field } = useController({ name: 'availability', control, defaultValue: [] })
  const selected: string[] = field.value ?? []

  function toggle(day: string) {
    const next = selected.includes(day)
      ? selected.filter((d) => d !== day)
      : [...selected, day]
    field.onChange(next)
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Availability</legend>
      <div className="flex flex-wrap gap-3">
        {DAYS.map((day) => (
          <div key={day} className="flex items-center gap-2">
            <Checkbox
              id={`day-${day}`}
              checked={selected.includes(day)}
              onCheckedChange={() => toggle(day)}
            />
            <Label htmlFor={`day-${day}`}>{day}</Label>
          </div>
        ))}
      </div>
      {errors.availability && <p className="mt-1 text-xs text-destructive">{String(errors.availability.message)}</p>}
    </fieldset>
  )
}
