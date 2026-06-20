// ─── Admin: WhatsApp message log ──────────────────────────────────────────────
// Shows recent outbound message events for audit / support, plus a flag-gated
// compose form for ops to send a one-off WhatsApp template to a single customer.

export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { TEMPLATES } from '@/lib/messaging-templates'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { ComposeMessageForm, type ComposeMessageTemplate } from './_components/ComposeMessageForm'
import { RetryMessageButton } from './_components/RetryMessageButton'

export const metadata = buildMetadata({ title: 'Messages', noIndex: true })

const RETRY_FLAG = 'admin.crud.messages'
const OUTBOUND_FLAG = 'admin.messages.outbound'

// Templates the compose form exposes. Excludes provider-side templates, OTP,
// templates that require non-trivial component shapes (e.g. URL buttons whose
// parameters cannot be entered as plain text), and templates intended for
// broadcast / automatic flows only.
const COMPOSE_ALLOWED_TEMPLATE_KEYS: string[] = [
  'please_confirm_with_provider',
  'customer_abandoned_recovery',
  'no_technician_available',
  'slot_available',
]

export default async function MessagesPage() {
  const admin = await requireAdmin()
  const retryEnabled = await isEnabled(RETRY_FLAG, { userId: admin.id })
  const outboundEnabled = await isEnabled(OUTBOUND_FLAG, { userId: admin.id })

  const composeTemplates: ComposeMessageTemplate[] = COMPOSE_ALLOWED_TEMPLATE_KEYS
    .filter((key) => key in TEMPLATES)
    .map((key) => {
      const tpl = TEMPLATES[key as keyof typeof TEMPLATES] as { name: string; category: string; description: string; example: string }
      return { key: tpl.name, category: tpl.category, description: tpl.description, example: tpl.example }
    })

  const messages = await db.messageEvent.findMany({
    include: {
      booking: { select: { id: true } },
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'DELIVERED' || status === 'READ') return 'default'
    if (status === 'FAILED') return 'destructive'
    return 'secondary'
  }

  return (
    <div>
      {!retryEnabled && (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Message retry mutations are read-only while <code>{RETRY_FLAG}</code> is disabled.
        </div>
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-sm text-muted-foreground">Last 100 outbound events</p>
      </div>

      <ComposeMessageForm
        templates={composeTemplates}
        disabled={!outboundEnabled}
        disabledReason={!outboundEnabled ? `Disabled while \`${OUTBOUND_FLAG}\` is off` : undefined}
      />

      {messages.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="Events are logged here when WhatsApp messages are sent."
        />
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div key={msg.id} className="rounded-xl border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <Badge
                      variant={getStatusVariant(msg.status)}
                      className="rounded-full capitalize text-xs"
                    >
                      {msg.status.toLowerCase()}
                    </Badge>
                    <span className="font-medium">{msg.to}</span>
                    {msg.customer && (
                      <span className="text-muted-foreground text-xs">({msg.customer.name})</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {msg.templateName ?? msg.channel}
                    </span>
                  </div>
                  {msg.body && (
                    <p className="text-xs text-muted-foreground truncate">{msg.body}</p>
                  )}
                  {msg.booking && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Booking: {msg.booking.id.slice(-8).toUpperCase()}
                    </p>
                  )}
                  {msg.failureReason && (
                    <p className="text-xs text-red-500 mt-0.5">{msg.failureReason}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <time className="text-xs text-muted-foreground">
                    {msg.createdAt.toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    {msg.createdAt.toLocaleTimeString('en-ZA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {msg.status === 'FAILED' && (
                    <RetryMessageButton
                      messageId={msg.id}
                      disabled={!retryEnabled}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
