'use client'

// TODO: replace text URL input with Vercel Blob client upload in follow-on PR
import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfilePhotoSection() {
  const { register, formState: { errors } } = useFormContext<{ profilePhotoUrl?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Profile photo</legend>
      <div>
        <Label htmlFor="profilePhotoUrl">Profile photo URL</Label>
        <Input id="profilePhotoUrl" type="url" placeholder="https://…" {...register('profilePhotoUrl')} />
        <p className="mt-1 text-xs text-muted-foreground">Paste a public photo URL. Direct upload coming soon.</p>
        {errors.profilePhotoUrl && <p className="mt-1 text-xs text-destructive">{String(errors.profilePhotoUrl.message)}</p>}
      </div>
    </fieldset>
  )
}
