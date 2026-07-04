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
    const file = e.target.files?.[0]
    if (!file) return

    // Reset the input so the same file can be re-selected after removal
    if (inputRef.current) inputRef.current.value = ''

    setUploading(true)
    setError(null)

    try {
      const url = await uploadFile(file)
      if (!isValidBlobUrl(url)) {
        setError('Upload failed: unexpected URL returned. Please try again.')
        return
      }
      onChange([...value, url])
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function handleRemove(url: string) {
    onChange(value.filter((u) => u !== url))
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
            <div key={url} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Evidence photo ${idx + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label={`Remove photo ${idx + 1}`}
                disabled={disabled}
                onClick={() => handleRemove(url)}
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

      {/* Add photo */}
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={addDisabled}
          onChange={handleFileChange}
          aria-label="Add photo"
        />
        <Button
          type="button"
          variant="outline"
          disabled={addDisabled}
          onClick={() => inputRef.current?.click()}
          aria-label="Add photo"
        >
          <Camera className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading…' : 'Add photo'}
        </Button>
      </div>
    </div>
  )
}
