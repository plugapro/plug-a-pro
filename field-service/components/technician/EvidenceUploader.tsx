'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getProviderActionClientErrorMessage } from '@/lib/provider-action-errors'

const MAX_FILE_SIZE = 10 * 1024 * 1024

type Props = {
  jobId: string
}

export function EvidenceUploader({ jobId }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [caption, setCaption] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    setError(null)

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        setError('Please choose image files only.')
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setError('Each photo must be under 10 MB.')
        if (inputRef.current) inputRef.current.value = ''
        return
      }
    }

    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }
    formData.append('caption', caption.trim())
    formData.append('label', 'evidence')

    try {
      const res = await fetch(`/api/technician/jobs/${jobId}/photo`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(
          getProviderActionClientErrorMessage({
            action: 'photo',
            status: res.status,
            error: data.error ?? null,
          }),
        )
        if (inputRef.current) inputRef.current.value = ''
        return
      }

      setCaption('')
      if (inputRef.current) inputRef.current.value = ''
      startTransition(() => router.refresh())
    } catch {
      setError(getProviderActionClientErrorMessage({ action: 'photo' }))
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3 rounded-xl border px-3 py-3">
      <div>
        <p className="text-sm font-medium">Add work photos</p>
        <p className="text-xs text-muted-foreground">
          Upload one or more photos from site. Add a short caption if it helps explain the work.
        </p>
      </div>

      <Textarea
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        rows={3}
        placeholder="Optional note, for example: leak repaired and pressure tested"
      />

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        {isPending ? 'Uploading…' : 'Upload evidence photos'}
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFilesChange}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
