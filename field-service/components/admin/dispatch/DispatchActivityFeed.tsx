'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ─── Unified event union ──────────────────────────────────────────────────────

export type ActivityEvent =
  | { kind: 'dispatch_no_match'; at: Date; consideredCount: number; noMatchReasons: { name: string; codes: string[] }[] }
  | { kind: 'dispatch_offered';  at: Date; providerName: string; score: number | null; explanation?: string | null }
  | { kind: 'dispatch_matched';  at: Date; providerName: string }
  | { kind: 'lead_sent';         at: Date; providerName: string; providerPhone: string }
  | { kind: 'lead_accepted';     at: Date; providerName: string }
  | { kind: 'lead_declined';     at: Date; providerName: string }
  | { kind: 'lead_expired';      at: Date; providerName: string }
  | { kind: 'credit_debit';      at: Date; providerName: string; creditsCharged: number; breakdown: Record<string, number> }
  | { kind: 'msg_out';           at: Date; recipientLabel: string; template?: string | null; body?: string | null; msgStatus: string }
  | { kind: 'msg_in';            at: Date; fromLabel: string; body?: string | null }
  | { kind: 'audit';             at: Date; action: string; actorRole: string }
  | { kind: 'case_event';        at: Date; summary: string; caseEventType: string; actorUserId?: string | null }

// ─── Collapsed NO_MATCH run ───────────────────────────────────────────────────

type NoMatchRun = {
  kind: 'no_match_run'
  firstAt: Date
  lastAt: Date
  count: number
  reasons: { name: string; codes: string[] }[]
}

type RenderItem =
  | { type: 'single'; event: ActivityEvent }
  | { type: 'collapsed'; run: NoMatchRun }

// ─── Component ────────────────────────────────────────────────────────────────

export function DispatchActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded for this request yet.</p>
  }

  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime())

  // Collapse consecutive dispatch_no_match events into runs
  const items = collapseNoMatchRuns(sorted)

  // Group by calendar day
  const days = groupByDay(items)

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <div key={day.label}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {day.label}
          </p>
          <ol className="relative ml-3 border-l border-border space-y-4">
            {day.items.map((item, i) => (
              <li key={i} className="ml-5 relative flex items-start gap-3">
                <DotFor item={item} />
                <div className="flex-1 min-w-0">
                  <ItemRow item={item} />
                </div>
                <TimeStamp item={item} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

// ─── Row renderers ────────────────────────────────────────────────────────────

function DotFor({ item }: { item: RenderItem }) {
  const cls = dotClass(item)
  return (
    <span className={cn(
      'absolute -left-[9px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-2 ring-background text-[9px] font-bold',
      cls,
    )} />
  )
}

function dotClass(item: RenderItem): string {
  if (item.type === 'collapsed') return 'bg-zinc-300 text-zinc-700'
  const ev = item.event
  switch (ev.kind) {
    case 'dispatch_no_match': return 'bg-zinc-300 text-zinc-700'
    case 'dispatch_offered':  return 'bg-blue-400 text-white'
    case 'dispatch_matched':  return 'bg-emerald-500 text-white'
    case 'lead_sent':         return 'bg-blue-400 text-white'
    case 'lead_accepted':     return 'bg-emerald-500 text-white'
    case 'lead_declined':     return 'bg-red-400 text-white'
    case 'lead_expired':      return 'bg-zinc-400 text-white'
    case 'credit_debit':      return 'bg-amber-400 text-amber-900'
    case 'msg_out':           return 'bg-violet-400 text-white'
    case 'msg_in':            return 'bg-slate-400 text-white'
    case 'audit':             return 'bg-zinc-300 text-zinc-600'
    case 'case_event':        return 'bg-cyan-400 text-white'
    default: return 'bg-zinc-300'
  }
}

function ItemRow({ item }: { item: RenderItem }) {
  if (item.type === 'collapsed') {
    const r = item.run
    const summaries = r.reasons.map((n) => `${n.name}: ${n.codes.join(', ')}`).join(' · ')
    return (
      <div className="space-y-0.5">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{r.count} retries</span>
          {' — no match each time'}
        </p>
        {summaries && (
          <p className="text-xs text-muted-foreground">{summaries}</p>
        )}
      </div>
    )
  }

  const ev = item.event

  switch (ev.kind) {
    case 'dispatch_no_match': {
      const summary = ev.noMatchReasons
        .map((n) => `${n.name}: ${n.codes.map(fmtCode).join(', ')}`)
        .join(' · ')
      return (
        <div className="space-y-0.5">
          <p className="text-sm">
            <span className="text-muted-foreground">Dispatch run</span>{' '}
            <Badge variant="neutral" className="text-xs">no match</Badge>
            {' '}
            <span className="text-xs text-muted-foreground">
              ({ev.consideredCount} considered)
            </span>
          </p>
          {summary && (
            <p className="text-xs text-muted-foreground">{summary}</p>
          )}
        </div>
      )
    }

    case 'dispatch_offered':
      return (
        <p className="text-sm">
          <span className="text-muted-foreground">Dispatch run</span>{' '}
          <Badge variant="info" className="text-xs">offered</Badge>
          {' '}
          <span className="font-medium">{ev.providerName}</span>
          {ev.score != null && (
            <span className="text-xs text-muted-foreground ml-1">score {ev.score.toFixed(3)}</span>
          )}
        </p>
      )

    case 'dispatch_matched':
      return (
        <p className="text-sm">
          <span className="text-muted-foreground">Dispatch run</span>{' '}
          <Badge variant="success" className="text-xs">matched</Badge>
          {' '}
          <span className="font-medium">{ev.providerName}</span>
        </p>
      )

    case 'lead_sent':
      return (
        <p className="text-sm">
          Lead sent to{' '}
          <span className="font-medium">{ev.providerName}</span>{' '}
          <span className="text-muted-foreground text-xs">({ev.providerPhone})</span>
        </p>
      )

    case 'lead_accepted':
      return (
        <p className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium">{ev.providerName}</span>
          <Badge variant="success" className="text-xs">accepted lead</Badge>
        </p>
      )

    case 'lead_declined':
      return (
        <p className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium">{ev.providerName}</span>
          <Badge variant="danger" className="text-xs">declined lead</Badge>
        </p>
      )

    case 'lead_expired':
      return (
        <p className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium">{ev.providerName}</span>
          <Badge variant="neutral" className="text-xs">lead expired (no response)</Badge>
        </p>
      )

    case 'credit_debit': {
      const parts = Object.entries(ev.breakdown)
        .filter(([, n]) => n > 0)
        .map(([type, n]) => `${n} ${type.toLowerCase()}`)
        .join(' + ')
      return (
        <p className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium">{ev.creditsCharged} credit{ev.creditsCharged !== 1 ? 's' : ''}</span>
          <span className="text-muted-foreground">charged to</span>
          <span className="font-medium">{ev.providerName}</span>
          {parts && <span className="text-xs text-muted-foreground">({parts})</span>}
        </p>
      )
    }

    case 'msg_out':
      return (
        <div className="space-y-0.5">
          <p className="text-sm flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground text-xs">→</span>
            <span className="font-medium">{ev.recipientLabel}</span>
            {ev.template && (
              <span className="font-mono text-xs text-muted-foreground">{ev.template}</span>
            )}
            <MsgBadge status={ev.msgStatus} />
          </p>
          {ev.body && !ev.template && (
            <p className="text-xs text-muted-foreground line-clamp-2 italic">&quot;{ev.body}&quot;</p>
          )}
        </div>
      )

    case 'msg_in':
      return (
        <div className="space-y-0.5">
          <p className="text-sm flex items-center gap-2 flex-wrap">
            <span className="font-medium">{ev.fromLabel}</span>
            <span className="text-muted-foreground text-xs">← inbound</span>
          </p>
          {ev.body && (
            <p className="text-xs text-muted-foreground line-clamp-2 italic">&quot;{ev.body}&quot;</p>
          )}
        </div>
      )

    case 'audit':
      return (
        <p className="text-sm flex items-center gap-2">
          <span className="text-muted-foreground">{fmtAction(ev.action)}</span>
          <span className="text-xs text-muted-foreground">· {ev.actorRole}</span>
        </p>
      )

    case 'case_event':
      return (
        <p className="text-sm flex items-center gap-2 flex-wrap">
          <Badge variant="neutral" className="text-xs">{fmtCode(ev.caseEventType)}</Badge>
          <span>{ev.summary}</span>
          {ev.actorUserId && (
            <span className="text-xs text-muted-foreground">· {ev.actorUserId.slice(-8)}</span>
          )}
        </p>
      )
  }
}

function TimeStamp({ item }: { item: RenderItem }) {
  if (item.type === 'collapsed') {
    return (
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground text-right whitespace-nowrap">
        {fmtTime(item.run.firstAt)}
        <br />
        <span className="text-muted-foreground/60">↓ {fmtTime(item.run.lastAt)}</span>
      </span>
    )
  }
  return (
    <span className="shrink-0 text-xs tabular-nums font-medium text-muted-foreground whitespace-nowrap">
      {fmtTime(item.event.at)}
    </span>
  )
}

// ─── Collapsing ───────────────────────────────────────────────────────────────

function collapseNoMatchRuns(events: ActivityEvent[]): RenderItem[] {
  const result: RenderItem[] = []
  let run: NoMatchRun | null = null

  for (const ev of events) {
    if (ev.kind === 'dispatch_no_match') {
      if (run && sameReasons(run.reasons, ev.noMatchReasons)) {
        // extend current run
        run.count++
        run.lastAt = ev.at
      } else {
        if (run) result.push({ type: 'collapsed', run })
        run = {
          kind: 'no_match_run',
          firstAt: ev.at,
          lastAt: ev.at,
          count: 1,
          reasons: ev.noMatchReasons,
        }
      }
    } else {
      if (run) {
        result.push(run.count === 1
          ? { type: 'single', event: { kind: 'dispatch_no_match', at: run.firstAt, consideredCount: 0, noMatchReasons: run.reasons } }
          : { type: 'collapsed', run }
        )
        run = null
      }
      result.push({ type: 'single', event: ev })
    }
  }
  if (run) {
    result.push(run.count === 1
      ? { type: 'single', event: { kind: 'dispatch_no_match', at: run.firstAt, consideredCount: 0, noMatchReasons: run.reasons } }
      : { type: 'collapsed', run }
    )
  }
  return result
}

function sameReasons(a: { name: string; codes: string[] }[], b: { name: string; codes: string[] }[]): boolean {
  if (a.length !== b.length) return false
  return a.every((ra, i) => ra.name === b[i].name && ra.codes.join() === b[i].codes.join())
}

// ─── Day grouping ─────────────────────────────────────────────────────────────

function groupByDay(items: RenderItem[]) {
  const days: Array<{ label: string; items: RenderItem[] }> = []
  for (const item of items) {
    const date = item.type === 'collapsed' ? item.run.firstAt : item.event.at
    const label = dayLabel(date)
    const last = days[days.length - 1]
    if (last?.label === label) {
      last.items.push(item)
    } else {
      days.push({ label, items: [item] })
    }
  }
  return days
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(date: Date) {
  return date.toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

function fmt(date: Date) {
  return date.toLocaleString('en-ZA', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

function dayLabel(date: Date): string {
  const d = new Date(date.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }))
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }))
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
}

function fmtCode(code: string) {
  return code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtAction(action: string) {
  return action.replace(/\./g, ' · ').replace(/_/g, ' ')
}

function MsgBadge({ status }: { status: string }) {
  const v: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
    READ: 'success', DELIVERED: 'success', SENT: 'neutral', QUEUED: 'warning', FAILED: 'danger',
  }
  return <Badge variant={v[status] ?? 'neutral'} className="text-xs">{status.toLowerCase()}</Badge>
}
