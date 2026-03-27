'use client'

// ─── Photo upload for job evidence ────────────────────────────────────────────
// Accepts a camera/file input, POSTs to /api/technician/jobs/[id]/photo,
// and shows a thumbnail on success.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Props {
  jobId: string
  label: 'before' | 'after'
  existingUrl?: string
  onUploaded: (url: string) => void
}

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

    const formData = new FormData()
    formData.append('file', file)
    formData.append('label', label)

    const res = await fetch(`/api/technician/jobs/${jobId}/photo`, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Upload failed. Please try again.')
      // Reset input so the same file can be retried
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    const data = await res.json()
    setPreviewUrl(data.url)
    onUploaded(data.url)
    startTransition(() => router.refresh())
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
