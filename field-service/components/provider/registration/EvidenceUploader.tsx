'use client'

import { useEffect, useRef, useState } from 'react'
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

type PendingFile = { file: File; status: 'uploading' | 'failed' }

export function EvidenceUploader({
  value,
  onChange,
  min,
  uploadFile,
  disabled = false,
}: EvidenceUploaderProps) {
  const [pending, setPending] = useState<PendingFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Kept current via effect so the sequential upload loop always appends to
  // the LATEST value/onChange, not the closure captured when the loop started.
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    valueRef.current = value
  }, [value])
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  async function uploadOne(file: File): Promise<string | null> {
    try {
      const url = await uploadFile(file)
      if (!isValidBlobUrl(url)) return null
      return url
    } catch {
      return null
    }
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    setError(null)
    setPending((prev) => [...prev, ...files.map((file) => ({ file, status: 'uploading' as const }))])

    const added: string[] = []
    for (const file of files) {
      const url = await uploadOne(file)
      if (url) {
        added.push(url)
        setPending((prev) => prev.filter((p) => p.file !== file))
      } else {
        setPending((prev) => prev.map((p) => (p.file === file ? { ...p, status: 'failed' } : p)))
      }
    }

    if (added.length > 0) onChangeRef.current([...valueRef.current, ...added])
    if (added.length < files.length) {
      setError('Some photos failed to upload. Tap retry next to each failed photo.')
    }
  }

  async function retryFile(target: File) {
    setPending((prev) => prev.map((p) => (p.file === target ? { ...p, status: 'uploading' } : p)))
    const url = await uploadOne(target)
    if (url) {
      setPending((prev) => prev.filter((p) => p.file !== target))
      onChangeRef.current([...valueRef.current, url])
    } else {
      setPending((prev) => prev.map((p) => (p.file === target ? { ...p, status: 'failed' } : p)))
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])

    // Reset the input so the same file set can be re-selected after removal.
    if (inputRef.current) inputRef.current.value = ''

    await handleFiles(files)
  }

  function handleRemove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  const uploading = pending.some((p) => p.status === 'uploading')
  const addDisabled = disabled || uploading

  return (
    <div className="flex flex-col gap-4">
      {/* Why we ask */}
      <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        <p>Customers pick providers with real work photos — profiles with 3+ photos get chosen far more often.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {['Finished job', 'Before & after', 'You at work'].map((example) => (
            <span key={example} className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
              {example}
            </span>
          ))}
        </div>
      </div>

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

      {/* Per-file upload progress / retry */}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pending.map((p) => (
            <li key={p.file.name + p.file.size} className="flex items-center gap-2 text-sm">
              <span className="truncate">{p.file.name}</span>
              {p.status === 'uploading' ? (
                <span className="text-muted-foreground">uploading…</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Retry ${p.file.name}`}
                  onClick={() => retryFile(p.file)}
                >
                  Retry
                </Button>
              )}
            </li>
          ))}
        </ul>
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
