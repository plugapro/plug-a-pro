'use client'

// TODO: pull from canonical lib/categories.ts list in follow-on PR
import { useFormContext, useController } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

const SKILL_OPTIONS = [
  'plumbing', 'electrical', 'painting', 'tiling', 'carpentry',
  'garden', 'aircon', 'geyser', 'locksmith', 'appliance',
]

export function SkillsSection() {
  const { control, formState: { errors } } = useFormContext<{ skills?: string[] }>()
  const { field } = useController({ name: 'skills', control, defaultValue: [] })
  const selected: string[] = field.value ?? []

  function toggle(skill: string) {
    const next = selected.includes(skill)
      ? selected.filter((s) => s !== skill)
      : [...selected, skill]
    field.onChange(next)
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Skills</legend>
      <div className="grid grid-cols-2 gap-2">
        {SKILL_OPTIONS.map((skill) => (
          <div key={skill} className="flex items-center gap-2">
            <Checkbox
              id={`skill-${skill}`}
              checked={selected.includes(skill)}
              onCheckedChange={() => toggle(skill)}
            />
            <Label htmlFor={`skill-${skill}`} className="capitalize">{skill}</Label>
          </div>
        ))}
      </div>
      {errors.skills && <p className="mt-1 text-xs text-destructive">{String(errors.skills.message)}</p>}
    </fieldset>
  )
}
