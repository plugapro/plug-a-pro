'use client'

// ─── Admin: compose a one-off WhatsApp template message ─────────────────────
// Posts to sendAdminWhatsappFromFormAction. Flag-gated by `admin.messages.outbound`.
// Customer is identified by phone (lookup happens server-side). The form is intentionally
// minimal — pick a template, fill its body params positionally, send. The server action
// records a `message.admin_send` audit row, creates a QUEUED MessageEvent, then fires
// the send async and updates status.

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/components/admin/ui/ActionToast'
import { sendAdminWhatsappFromFormAction } from '../actions'

export interface ComposeMessageTemplate {
  key: string
  category: string
  description: string
  example: string
}

interface ComposeMessageFormProps {
  templates: ComposeMessageTemplate[]
  disabled?: boolean
  disabledReason?: string
}

function paramPlaceholderCount(example: string): number {
  const matches = example.match(/\{\{\d+\}\}/g)
  if (!matches) return 0
  const numbers = new Set(matches.map((m) => Number(m.slice(2, -2))))
  return numbers.size
}

export function ComposeMessageForm({ templates, disabled, disabledReason }: ComposeMessageFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const initialKey = templates[0]?.key ?? ''
  const initialCount = templates[0] ? paramPlaceholderCount(templates[0].example) : 0
  const [customerId, setCustomerId] = React.useState('')
  const [templateKey, setTemplateKey] = React.useState(initialKey)
  const [params, setParams] = React.useState<string[]>(() => new Array(initialCount).fill(''))
  const selectedTemplate = templates.find((t) => t.key === templateKey)
  const expectedParams = selectedTemplate ? paramPlaceholderCount(selectedTemplate.example) : 0

  function handleTemplateChange(nextKey: string) {
    setTemplateKey(nextKey)
    const next = templates.find((t) => t.key === nextKey)
    const nextCount = next ? paramPlaceholderCount(next.example) : 0
    setParams(new Array(nextCount).fill(''))
  }

  function previewBody(): string {
    if (!selectedTemplate) return ''
    return selectedTemplate.example.replace(/\{\{(\d+)\}\}/g, (_match, raw: string) => {
      const idx = Number(raw) - 1
      const value = params[idx] ?? ''
      return value || `{{${raw}}}`
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId.trim()) {
      notify.userError('Customer ID is required')
      return
    }
    if (!templateKey) {
      notify.userError('Template is required')
      return
    }
    if (params.some((p) => !p.trim())) {
      notify.userError(`All ${expectedParams} body parameters are required`)
      return
    }
    startTransition(async () => {
      const formData = new FormData()
      formData.set('customerId', customerId.trim())
      formData.set('templateKey', templateKey)
      formData.set('bodyParams', JSON.stringify(params))
      const result = await sendAdminWhatsappFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Message queued — Meta delivery is async')
        setCustomerId('')
        setParams(new Array(expectedParams).fill(''))
        router.refresh()
      } else {
        notify.userError(
          (result && 'error' in result ? result.error : undefined) ?? 'Failed to send message',
        )
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-xl border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Compose message</h2>
        {disabled && disabledReason && (
          <span className="text-xs text-muted-foreground">{disabledReason}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="compose-customer-id" className="text-xs">Customer ID</Label>
          <Input
            id="compose-customer-id"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="e.g. cmqf77upu002hl4046s0c1ew3"
            disabled={disabled || isPending}
            required
          />
          <p className="text-xs text-muted-foreground">Find in /admin/customers — copy from the URL or list.</p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="compose-template" className="text-xs">Template</Label>
          <Select value={templateKey} onValueChange={handleTemplateChange} disabled={disabled || isPending}>
            <SelectTrigger id="compose-template">
              <SelectValue placeholder="Choose a template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((tpl) => (
                <SelectItem key={tpl.key} value={tpl.key}>
                  {tpl.key} ({tpl.category})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedTemplate && (
            <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
          )}
        </div>
      </div>

      {expectedParams > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Body parameters</Label>
          {Array.from({ length: expectedParams }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">{`{{${i + 1}}}`}</span>
              <Input
                value={params[i] ?? ''}
                onChange={(e) =>
                  setParams((prev) => {
                    const next = [...prev]
                    next[i] = e.target.value
                    return next
                  })
                }
                placeholder={`Value for {{${i + 1}}}`}
                disabled={disabled || isPending}
                required
              />
            </div>
          ))}
        </div>
      )}

      {selectedTemplate && (
        <div className="space-y-1">
          <Label className="text-xs">Preview</Label>
          <Textarea
            value={previewBody()}
            readOnly
            rows={3}
            className="font-mono text-xs"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={disabled || isPending}>
          {isPending ? 'Sending…' : 'Send'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Logged as <code>message.admin_send</code>. Delivery is async — refresh to see status.
        </span>
      </div>
    </form>
  )
}
