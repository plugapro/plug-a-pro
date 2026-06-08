'use client'

import * as React from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  phone: string
  className?: string
}

export function CopyWaLink({ phone, className }: Props) {
  const [copied, setCopied] = React.useState(false)
  const digits = phone.replace(/\D/g, '')
  const url = `https://wa.me/${digits}`

  async function handle() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handle}
      className={className}
      aria-label={copied ? 'WhatsApp link copied' : 'Copy WhatsApp link'}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
      <span className="text-xs">{copied ? 'Copied' : 'WhatsApp link'}</span>
      <Copy className="ml-1 h-3 w-3 opacity-50" aria-hidden="true" />
    </Button>
  )
}
