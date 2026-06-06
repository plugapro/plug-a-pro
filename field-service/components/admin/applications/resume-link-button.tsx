'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { generateResumeLinkAction } from '@/app/(admin)/admin/applications/recovery-actions'

export interface ResumeLinkButtonProps {
  conversationId: string
  disabled?: boolean
}

export function ResumeLinkButton(props: ResumeLinkButtonProps) {
  const [pending, startTransition] = useTransition()
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)

  if (props.disabled) {
    return <Button size="sm" variant="ghost" disabled>Resume link</Button>
  }

  const onClick = () => startTransition(async () => {
    try {
      const result = await generateResumeLinkAction({ conversationId: props.conversationId })
      if (result.ok) {
        await navigator.clipboard.writeText(result.url).catch(() => undefined)
        setGeneratedUrl(result.url)
        toast.success('Resume link copied to clipboard.')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate link.'
      toast.error(message)
    }
  })

  if (generatedUrl) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <code className="break-all rounded bg-muted px-1 py-0.5">{generatedUrl}</code>
        <Button size="sm" variant="ghost" onClick={onClick} disabled={pending}>Regenerate</Button>
      </div>
    )
  }

  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={pending}>
      {pending ? 'Generating…' : 'Generate resume link'}
    </Button>
  )
}
