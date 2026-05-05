'use client'
// ─── CaseActivityTimeline ─────────────────────────────────────────────────────
// Renders Case events chronologically, grouped by calendar day.
// Append-only — no edit/delete UI.

import type { CaseEvent } from '@prisma/client'
import { relativeTime } from '@/lib/utils'

const EVENT_ICONS: Record<string, string> = {
  STATE_CHANGE:         '~',
  SYSTEM_EVENT:         '*',
  OPS_ACTION:           '>',
  NOTE_ADDED:           '#',
  ATTACHMENT_ADDED:     '+',
  ASSIGNMENT_CHANGE:    '@',
  CUSTOMER_CONTACTED:   'c',
  ESCALATION:           '!',
  BREACH_DETECTED:      '!',
}

function humanSummary(event: CaseEvent): string {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case 'STATE_CHANGE':
      return `Status changed${p.from ? ` from ${p.from}` : ''} to ${p.to ?? '—'}${p.reasonCode ? ` · ${p.reasonCode}` : ''}`
    case 'ASSIGNMENT_CHANGE':
      if (p.released) return 'Released — back to unassigned'
      return p.to ? `Assigned to ${p.to}` : 'Assignment changed'
    case 'NOTE_ADDED':
      return `Note added${p.preview ? `: "${p.preview}…"` : ''}`
    case 'BREACH_DETECTED':
      return 'SLA breach detected'
    case 'ESCALATION':
      return `Escalated${p.reason ? `: ${p.reason}` : ''}`
    case 'OPS_ACTION':
      return p.action ? String(p.action) : 'Ops action recorded'
    case 'SYSTEM_EVENT':
      return p.event ? String(p.event) : 'System event'
    default:
      return event.type
  }
}


function dayLabel(date: Date): string {
  const today = new Date()
  const d = new Date(date)
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function CaseActivityTimeline({ events }: { events: CaseEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No activity yet.</p>
  }

  // Group events by calendar day
  const grouped: Array<{ label: string; items: CaseEvent[] }> = []
  for (const event of events) {
    const label = dayLabel(new Date(event.createdAt))
    const last = grouped[grouped.length - 1]
    if (last?.label === label) {
      last.items.push(event)
    } else {
      grouped.push({ label, items: [event] })
    }
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-medium text-muted-foreground mb-2">{group.label}</p>
          <div className="space-y-2">
            {group.items.map((event) => (
              <div key={event.id} className="flex gap-3 items-start">
                <span className="text-base leading-5 mt-0.5 shrink-0">{EVENT_ICONS[event.type] ?? '•'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{humanSummary(event)}</p>
                  {event.actorUserId && (
                    <p className="text-xs text-muted-foreground">{event.actorUserId}</p>
                  )}
                </div>
                <span
                  className="text-xs text-muted-foreground shrink-0 cursor-default"
                  title={new Date(event.createdAt).toLocaleString('en-ZA')}
                >
                  {relativeTime(new Date(event.createdAt))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
