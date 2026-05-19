'use client'

import { useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

type AttachmentThumbnailProps = {
  attachmentId: string
  src: string
  alt?: string | null
  className?: string
  fallbackText?: string
  showDiagnostics?: boolean
}

function createImageTraceId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `img_${crypto.randomUUID().slice(0, 8)}`
  }

  return `img_${Math.random().toString(36).slice(2, 10)}`
}

export function AttachmentThumbnail({
  attachmentId,
  src,
  alt,
  className = 'h-32 w-full rounded-lg object-cover',
  fallbackText = 'Photo unavailable',
  showDiagnostics = true,
}: AttachmentThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const traceId = useMemo(() => createImageTraceId(), [])
  const imageAlt = alt?.trim() || 'Customer photo'

  if (failed) {
    return (
      <div
        role="status"
        aria-label={fallbackText}
        className="flex min-h-32 flex-col justify-center rounded-lg border tone-warning p-3 text-xs"
      >
        <p className="font-medium">{fallbackText}</p>
        {showDiagnostics && (
          <div className="mt-2 space-y-0.5">
            <p>Attachment ID: {attachmentId}</p>
            <p>Error code: IMAGE_RENDER_FAILED</p>
            <p>Trace ID: {traceId}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
            <button type="button" className="block w-full cursor-zoom-in focus:outline-none">
              { }
              {/* next/image does not support onError; we need it to detect broken proxy responses. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
            src={src}
            alt={imageAlt}
            className={className}
            onError={() => {
              console.warn('[attachment-thumbnail] image render failed', {
                attachmentId,
                errorCode: 'IMAGE_RENDER_FAILED',
                traceId,
              })
              setFailed(true)
            }}
          />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{imageAlt}</DialogPrimitive.Title>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={imageAlt}
            className="max-h-screen max-w-full object-contain"
          />
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-full bg-black/60 p-2.5 text-white transition-colors hover:bg-black/80 focus:outline-none">
            <XIcon className="size-6" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
