'use client'

import { useFormContext, useController } from 'react-hook-form'
import { EvidenceUploader } from '@/components/provider/registration/EvidenceUploader'

export interface EvidenceSectionProps {
  rawToken: string
  gateEnabled?: boolean
  minPhotos?: number
}

export function EvidenceSection({ rawToken, gateEnabled = false, minPhotos = 3 }: EvidenceSectionProps) {
  const { control, formState: { errors } } = useFormContext<{ evidenceFileUrls?: string[] }>()
  const { field } = useController({ name: 'evidenceFileUrls', control, defaultValue: [] })

  async function uploadFile(file: File): Promise<string> {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/provider/signup/evidence-photo', {
      method: 'POST',
      headers: rawToken ? { 'x-provider-resume-token': rawToken } : {},
      body: fd,
    })
    const json = await res.json() as { ok: boolean; url?: string; message?: string }
    if (!json.ok || !json.url) {
      throw new Error(json.message ?? 'Upload failed')
    }
    return json.url
  }

  const errorMessage = errors.evidenceFileUrls?.message
    ? String(errors.evidenceFileUrls.message)
    : (errors.evidenceFileUrls as { root?: { message?: string } } | undefined)?.root?.message

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Supporting evidence</legend>
      {gateEnabled && (
        <p className="text-sm text-muted-foreground">
          Upload at least {minPhotos} photos of your past work (e.g. completed jobs, tools, equipment).
        </p>
      )}
      <EvidenceUploader
        value={(field.value as string[]) ?? []}
        onChange={field.onChange}
        min={gateEnabled ? minPhotos : 0}
        uploadFile={uploadFile}
      />
      {errorMessage && (
        <p className="mt-1 text-xs text-destructive">{errorMessage}</p>
      )}
    </fieldset>
  )
}
