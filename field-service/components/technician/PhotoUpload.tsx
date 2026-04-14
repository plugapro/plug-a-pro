'use client'

// ─── Photo upload for job evidence ────────────────────────────────────────────
// Accepts a camera/file input, POSTs to /api/technician/jobs/[id]/photo,
// and shows a thumbnail on success.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getProviderActionClientErrorMessage } from '@/lib/provider-action-errors'

interface Props {
  jobId: string
  label: 'before' | 'after'
  existingUrl?: string
  onUploaded: (url: string) => void
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

export function PhotoUpload({ jobId, label, existingUrl, onUploaded }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl ?? null)
  const [error, setError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)

    if (!file.type.startsWith('image/')) {
      setError('Please choose a valid image file.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('Photo is too large. Use an image under 10 MB.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('label', label)

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

      const data = await res.json() as { proxyUrl?: string | null }
      if (!data.proxyUrl) {
        setError('Photo uploaded, but we could not load it back into the job right now. Refresh the page.')
        if (inputRef.current) inputRef.current.value = ''
        return
      }

      setPreviewUrl(data.proxyUrl)
      onUploaded(data.proxyUrl)
      startTransition(() => router.refresh())
      if (inputRef.current) inputRef.current.value = ''
    } catch {
      setError(
        getProviderActionClientErrorMessage({
          action: 'photo',
        }),
      )
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const labelText = label === 'before' ? 'Before photo' : 'After photo'

  return (
    <div className="space-y-2">
      {previewUrl ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={labelText}
            className="rounded-lg object-cover w-full h-40"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
            className="w-full"
          >
            {isPending ? 'Uploading…' : `Replace ${labelText.toLowerCase()}`}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
          className="w-full"
        >
          {isPending ? 'Uploading…' : `Add ${labelText.toLowerCase()}`}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
