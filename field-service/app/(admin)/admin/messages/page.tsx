// ─── Admin: WhatsApp message log ──────────────────────────────────────────────
// Shows recent outbound message events for audit / support.

export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'

export const metadata = buildMetadata({ title: 'Messages', noIndex: true })

export default async function MessagesPage() {
  const user = await requireAdmin()
  let businessId = user.businessId
  if (!businessId) {
    const { resolveBusinessId } = await import('@/lib/auth')
    businessId = await resolveBusinessId()
  }

  const messages = await db.messageEvent.findMany({
    where: { businessId },
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-sm text-muted-foreground">Last 100 outbound events</p>
      </div>

      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No messages yet. Events are logged when WhatsApp messages are sent.
        </div>
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
                <time className="shrink-0 text-xs text-muted-foreground">
                  {msg.createdAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                  })}{' '}
                  {msg.createdAt.toLocaleTimeString('en-ZA', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
