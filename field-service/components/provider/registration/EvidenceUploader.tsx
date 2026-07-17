'use client'

import { useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface EvidenceUploaderProps {
  value: string[]
  onChange: (urls: string[]) => void
  min: number
  /**
   * Uploads one file and resolves to its stored blob URL. Supplied by the
   * consuming surface (session-authed for /provider/register, token-authed
   * for /provider/signup).
   */
  uploadFile: (file: File) => Promise<string>
  disabled?: boolean
}

/**
 * Validates that a URL returned from uploadFile looks like a Vercel Blob URL.
 * Mirrors cleanUrlString in lib/provider-registration/pwa-flow.ts.
 */
function isValidBlobUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    return (
      parsed.protocol === 'https:' &&
      (host === 'vercel-storage.com' || host.endsWith('.vercel-storage.com'))
    )
  } catch {
    return false
  }
}

export function EvidenceUploader({
  value,
  onChange,
  min,
  uploadFile,
  disabled = false,
}: EvidenceUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    // Reset the input so the same file set can be re-selected after removal.
    if (inputRef.current) inputRef.current.value = ''

    setUploading(true)
    setError(null)

    const uploadedUrls: string[] = []
    try {
      for (const file of files) {
        const url = await uploadFile(file)
        if (!isValidBlobUrl(url)) {
          setError('Upload failed: unexpected URL returned. Please try again.')
          break
        }
        uploadedUrls.push(url)
      }

      if (uploadedUrls.length > 0) {
        onChange([...value, ...uploadedUrls])
      }
    } catch {
      if (uploadedUrls.length > 0) {
        onChange([...value, ...uploadedUrls])
      }
      setError(uploadedUrls.length > 0
        ? 'Some photos uploaded, but one failed. Please add the remaining photo again.'
        : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function handleRemove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  const addDisabled = disabled || uploading

  return (
    <div className="flex flex-col gap-4">
      {/* Counter */}
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{value.length} of {min}</span>{' '}
        photos added{value.length >= min ? ' — minimum reached' : ''}
      </p>

      {/* Thumbnails */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {value.map((url, idx) => (
            <div key={`${idx}-${url}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- Vercel Blob URLs are pre-optimised; next/image would require domain config */}
              <img
                src={url}
                alt={`Evidence photo ${idx + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label={`Remove photo ${idx + 1}`}
                disabled={disabled}
                onClick={() => handleRemove(idx)}
                className={cn(
                  'absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Add photos */}
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={addDisabled}
          onChange={handleFileChange}
          aria-hidden="true"
        />
        <Button
          type="button"
          variant="outline"
          disabled={addDisabled}
          onClick={() => inputRef.current?.click()}
          aria-label="Add work photos"
        >
          <Camera className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading photos…' : 'Add photos'}
        </Button>
      </div>
    </div>
  )
}
