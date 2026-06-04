'use client'

import { useState, useTransition } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logRecoveryMessageCopiedAction } from '@/app/(admin)/admin/onboarding-recovery/actions'

type CopyRecoveryMessageButtonProps = {
  message: string
  stage: string
  phoneTail: string
  maskedPhone: string
  conversationId?: string | null
  applicationId?: string | null
}

export function CopyRecoveryMessageButton({
  message,
  stage,
  phoneTail,
  maskedPhone,
  conversationId,
  applicationId,
}: CopyRecoveryMessageButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
    startTransition(() => {
      void logRecoveryMessageCopiedAction({
        stage,
        phoneTail,
        maskedPhone,
        conversationId,
        applicationId,
      })
    })
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      onClick={handleCopy}
      disabled={isPending}
      aria-label={`Copy recovery message for phone ending ${phoneTail}`}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
