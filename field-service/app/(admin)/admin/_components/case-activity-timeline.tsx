import { formatDistanceToNow } from 'date-fns'
import type { CaseEvent, CaseEventType } from '@prisma/client'

const EVENT_ICONS: Record<CaseEventType, string> = {
  STATE_CHANGE: '⚡',
  SYSTEM_EVENT: '🤖',
  OPS_ACTION: '🛠',
  NOTE_ADDED: '📝',
  ATTACHMENT_ADDED: '📎',
  ASSIGNMENT_CHANGE: '👤',
  CUSTOMER_CONTACTED: '📞',
  ESCALATION: '🔺',
  BREACH_DETECTED: '⚠️',
  INTERNAL_ONLY: '🔒',
}

const EVENT_LABELS: Record<CaseEventType, string> = {
  STATE_CHANGE: 'Status changed',
  SYSTEM_EVENT: 'System event',
  OPS_ACTION: 'Ops action',
  NOTE_ADDED: 'Note added',
  ATTACHMENT_ADDED: 'Attachment added',
  ASSIGNMENT_CHANGE: 'Assignment changed',
  CUSTOMER_CONTACTED: 'Customer contacted',
  ESCALATION: 'Escalated',
  BREACH_DETECTED: 'SLA breach detected',
  INTERNAL_ONLY: 'Internal note',
}

interface Props {
  events: Pick<CaseEvent, 'id' | 'type' | 'payload' | 'actorUserId' | 'createdAt'>[]
}

export function CaseActivityTimeline({ events }: Props) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  }

  return (
    <ol className="space-y-3">
      {events
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((evt) => (
          <li key={evt.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 text-base leading-none" aria-hidden>
              {EVENT_ICONS[evt.type]}
            </span>
            <div className="flex-1">
              <span className="font-medium">{EVENT_LABELS[evt.type]}</span>
              {evt.actorUserId && (
                <span className="text-muted-foreground"> by {evt.actorUserId}</span>
              )}
              <span
                className="ml-2 text-xs text-muted-foreground"
                title={new Date(evt.createdAt).toISOString()}
              >
                {formatDistanceToNow(new Date(evt.createdAt), { addSuffix: true })}
              </span>
            </div>
          </li>
        ))}
    </ol>
  )
}
