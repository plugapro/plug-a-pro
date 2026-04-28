'use client'

import { useMemo, useState } from 'react'

type AttachmentThumbnailProps = {
  attachmentId: string
  src: string
  href?: string
  alt?: string | null
  className?: string
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
  href,
  alt,
  className = 'h-32 w-full rounded-lg object-cover',
}: AttachmentThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const traceId = useMemo(() => createImageTraceId(), [])
  const imageAlt = alt?.trim() || 'Customer photo'

  if (failed) {
    return (
      <div
        role="status"
        className="flex min-h-32 flex-col justify-center rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
      >
        <p className="font-medium">Photo could not be loaded</p>
        <p className="mt-2">Attachment ID: {attachmentId}</p>
        <p>Error code: IMAGE_RENDER_FAILED</p>
        <p>Trace ID: {traceId}</p>
      </div>
    )
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
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
  )

  if (!href) return image

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {image}
    </a>
  )
}
