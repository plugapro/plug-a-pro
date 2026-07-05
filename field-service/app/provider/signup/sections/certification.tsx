'use client'

import { useFormContext, useWatch } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { hasHighRiskServiceSelection } from '@/lib/service-category-policy'

/**
 * Renders the certification field.
 *
 * `conditionalOnSkills` (Fix 5): when true, the section is only shown when the
 * live in-form skills selection includes a high-risk trade. This covers the case
 * where skills are chosen in-form (so the server couldn't decide the section from
 * captured data) — the field appears the moment a high-risk skill is ticked, and
 * stays hidden otherwise so a non-high-risk applicant is never blocked. When
 * false (skills already captured as high-risk), the field always shows.
 */
export function CertificationSection({ conditionalOnSkills = false }: { conditionalOnSkills?: boolean }) {
  const { register, control, formState: { errors } } = useFormContext<{ certificationRef?: string; skills?: string[] }>()
  const watchedSkills = useWatch({ control, name: 'skills' }) as string[] | undefined

  if (conditionalOnSkills && !hasHighRiskServiceSelection(watchedSkills ?? [])) {
    return null
  }

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
