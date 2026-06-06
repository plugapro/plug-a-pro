'use client'

import { useFormContext } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function BioSection() {
  const { register, watch, formState: { errors } } = useFormContext<{ bio?: string }>()
  const bio = watch('bio') ?? ''
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Bio</legend>
      <div>
        <Label htmlFor="bio">Tell customers about yourself</Label>
        <Textarea id="bio" rows={4} placeholder="Your experience, approach, and what makes you great at the job…" {...register('bio')} />
        <p className="mt-1 text-xs text-muted-foreground">{bio.length} / 500 characters (min 20)</p>
        {errors.bio && <p className="mt-1 text-xs text-destructive">{String(errors.bio.message)}</p>}
      </div>
    </fieldset>
  )
}
