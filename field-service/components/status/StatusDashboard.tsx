'use client'

import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  EyeOff,
  GitBranch,
  HelpCircle,
  RefreshCw,
  Shield,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  buildFallbackHealthModel,
  getActiveIssues,
  normalizeHealthPayload,
  STATUS_LABELS,
  statusToneFromCheck,
  summarizeGroup,
  type HealthDashboardModel,
  type HealthService,
  type HealthServiceGroup,
  type HealthStatus,
} from '@/lib/status/health'

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const AUTO_REFRESH_INTERVAL_S = 30

// Journey definitions with status-aware plain-language impact text
const JOURNEY_DEFS: {
  id: string
  groupId: string
  label: string
  sub: string
  icon: ComponentType<{ className?: string }>
  impact: Record<HealthStatus | 'default', string>
}[] = [
  {
    id: 'client',
    groupId: 'client-journey',
    label: 'Customer Journey',
    sub: 'Track booking, request creation, provider browsing',
    icon: Users,
    impact: {
      operational: 'Track booking, request creation, and provider browsing are working.',
      degraded: 'Some booking and browsing actions may be slower than usual.',
      down: 'Customers may be unable to book, track requests, or browse providers.',
      unknown: 'Booking status cannot be confirmed right now.',
      not_monitored: 'This journey is not directly monitored yet.',
      default: 'This journey is not directly monitored yet.',
    },
  },
  {
    id: 'provider',
    groupId: 'provider-journey',
    label: 'Provider Journey',
    sub: 'Leads, jobs, portal and availability',
    icon: Wrench,
    impact: {
      operational: 'Provider leads, jobs, and portal availability are healthy.',
      degraded: 'Provider leads, jobs, or portal access may be delayed.',
      down: 'Providers may not receive new leads or manage jobs.',
      unknown: 'Provider journey status cannot be confirmed right now.',
      not_monitored: 'This journey is not directly monitored yet.',
      default: 'This journey is not directly monitored yet.',
    },
  },
  {
    id: 'merchant',
    groupId: 'merchant-journey',
    label: 'Merchant / Commercial Journey',
    sub: 'Quoting, payments, invoicing',
    icon: Building2,
    impact: {
      operational: 'Quoting, payment, and invoicing journeys are processing normally.',
      degraded: 'Some quote or payment actions may be slower than usual.',
      down: 'Commercial actions like quoting and payment may be unavailable.',
      unknown: 'Commercial journey status cannot be confirmed right now.',
      not_monitored: 'This journey is not directly monitored yet.',
      default: 'This journey is not directly monitored yet.',
    },
  },
  {
    id: 'ops',
    groupId: 'core-platform',
    label: 'Platform Operations',
    sub: 'Core services and monitoring',
    icon: Activity,
    impact: {
      operational: 'Core platform services are healthy and bookings remain available.',
      degraded: 'Some platform surfaces are experiencing disruption.',
      down: 'Core service routing and data access are affected.',
      unknown: 'Platform status cannot be confirmed right now.',
      not_monitored: 'Platform monitoring is available from health signals.',
      default: 'Platform monitoring is available from health signals.',
    },
  },
]

// ─────────────────────────────────────────────────────────────
// STATUS UTILITIES
// ─────────────────────────────────────────────────────────────

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

function tone(status: HealthStatus): Tone {
  return statusToneFromCheck[status]
}

// Tailwind classes keyed by tone — avoids dynamic string interpolation
const T = {
  success: {
    bg: 'bg-[var(--tone-success-bg)]',
    border: 'border-[var(--tone-success-border)]',
    fg: 'text-[var(--tone-success-fg)]',
    dot: 'bg-[var(--tone-success-fg)]',
    borderL: 'border-l-[var(--tone-success-fg)]',
    borderT: 'border-t-[var(--tone-success-fg)]',
  },
  warning: {
    bg: 'bg-[var(--tone-warning-bg)]',
    border: 'border-[var(--tone-warning-border)]',
    fg: 'text-[var(--tone-warning-fg)]',
    dot: 'bg-[var(--tone-warning-fg)]',
    borderL: 'border-l-[var(--tone-warning-fg)]',
    borderT: 'border-t-[var(--tone-warning-fg)]',
  },
  danger: {
    bg: 'bg-[var(--tone-danger-bg)]',
    border: 'border-[var(--tone-danger-border)]',
    fg: 'text-[var(--tone-danger-fg)]',
    dot: 'bg-[var(--tone-danger-fg)]',
    borderL: 'border-l-[var(--tone-danger-fg)]',
    borderT: 'border-t-[var(--tone-danger-fg)]',
  },
  neutral: {
    bg: 'bg-[var(--tone-neutral-bg)]',
    border: 'border-[var(--tone-neutral-border)]',
    fg: 'text-[var(--tone-neutral-fg)]',
    dot: 'bg-[var(--tone-neutral-fg)]',
    borderL: 'border-l-[var(--tone-neutral-fg)]',
    borderT: 'border-t-[var(--tone-neutral-fg)]',
  },
} satisfies Record<Tone, Record<string, string>>

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-ZA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function headlineFor(status: HealthStatus): string {
  switch (status) {
    case 'operational': return 'All Systems Operational'
    case 'degraded': return 'Partial Service Disruption'
    case 'down': return 'Service Outage Detected'
    default: return 'Status Unavailable'
  }
}

// ─────────────────────────────────────────────────────────────
// ATOMS
// ─────────────────────────────────────────────────────────────

function StatusDot({ status, size = 'md' }: { status: HealthStatus; size?: 'sm' | 'md' | 'lg' }) {
  const cls = T[tone(status)]
  const ping = status === 'operational'
  const pulse = status === 'down'
  const sizes = { sm: 'size-2', md: 'size-2.5', lg: 'size-3.5' }
  const rings = { sm: 'size-4', md: 'size-5', lg: 'size-6' }

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      {(ping || pulse) && (
        <span
          className={`absolute inline-flex ${rings[size]} rounded-full opacity-25 ${cls.dot} ${ping ? 'animate-ping' : 'animate-pulse'}`}
        />
      )}
      <span className={`relative inline-flex ${sizes[size]} rounded-full ${cls.dot}`} />
    </span>
  )
}

function StatusIcon({ status, className = 'size-4' }: { status: HealthStatus; className?: string }) {
  const cls = T[tone(status)]
  switch (status) {
    case 'operational': return <CheckCircle2 className={`${className} ${cls.fg}`} />
    case 'degraded':    return <AlertCircle  className={`${className} ${cls.fg}`} />
    case 'down':        return <XCircle      className={`${className} ${cls.fg}`} />
    default:            return <HelpCircle   className={`${className} ${cls.fg}`} />
  }
}

function StatusPill({ status }: { status: HealthStatus }) {
  return (
    <Badge variant={tone(status)} className="font-mono text-[11px] tracking-wide">
      {STATUS_LABELS[status]}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────
// HERO STATUS BANNER
// ─────────────────────────────────────────────────────────────

function HeroStatusBanner({
  model,
  onRefresh,
  loading,
  countdown,
  error,
}: {
  model: HealthDashboardModel
  onRefresh: () => void
  loading: boolean
  countdown: number
  error: string | null
}) {
  const cls = T[tone(model.overall)]

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-l-4 ${cls.borderL} ${cls.border} bg-card shadow-[var(--shadow-soft)]`}
    >
      {/* Subtle tinted top-right accent blob */}
      <div
        className={`pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-10 blur-2xl ${cls.dot}`}
        aria-hidden
      />

      <div className="relative px-5 py-5 sm:px-6">
        {/* Top row: brand kicker + refresh */}
        <div className="mb-4 flex items-center justify-between">
          <p className="app-kicker text-muted-foreground/60">Plug-A-Pro · Service Status</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh status"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Checking…' : `${countdown}s`}
          </button>
        </div>

        {/* Main status */}
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="mt-1 shrink-0">
            <StatusDot status={model.overall} size="lg" />
          </div>
          <div className="min-w-0">
            <h1 className={`text-xl font-bold tracking-tight sm:text-2xl ${cls.fg}`}>
              {headlineFor(model.overall)}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              {model.botMessage}
            </p>
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <Clock className="size-3 shrink-0" />
            {formatDate(model.asOf)}
          </span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <span className="flex items-center gap-1">
            <Bot className="size-3 shrink-0" />
            Plug-A-Pro Bot
          </span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <span>Auto-refresh every {AUTO_REFRESH_INTERVAL_S}s</span>
        </div>

        {/* Fetch error notice */}
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--tone-warning-fg)]" />
            <span>
              <span className="font-semibold text-[var(--tone-warning-fg)]">Refresh failed. </span>
              <span className="text-muted-foreground">Showing last known state.</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// JOURNEY HEALTH STRIP
// ─────────────────────────────────────────────────────────────

function JourneyCard({
  label,
  sub,
  status,
  impactText,
  icon: Icon,
}: {
  label: string
  sub: string
  status: HealthStatus
  impactText: string
  icon: ComponentType<{ className?: string }>
}) {
  const cls = T[tone(status)]
  const isIssue = status === 'down' || status === 'degraded'

  return (
    <div
      className={`flex flex-col gap-2.5 rounded-xl border border-t-2 ${cls.borderT} ${cls.border} ${isIssue ? cls.bg : 'bg-card'} px-3.5 py-3 shadow-[var(--shadow-soft)]`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold tracking-tight">{label}</span>
        </div>
        <StatusDot status={status} size="sm" />
      </div>
      <div className="space-y-1">
        <p className="line-clamp-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          What this means
        </p>
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{impactText}</p>
      </div>
      <div className="mt-auto">
        <StatusPill status={status} />
      </div>
    </div>
  )
}

function JourneyHealthStrip({ model }: { model: HealthDashboardModel }) {
  const groupMap = useMemo(
    () => model.groups.reduce<Record<string, HealthServiceGroup>>((acc, g) => { acc[g.id] = g; return acc }, {}),
    [model.groups],
  )

  return (
    <section aria-label="Journey health overview">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Journey Status
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {JOURNEY_DEFS.map(({ id, groupId, label, sub, icon, impact }) => {
          const group = groupMap[groupId]
          const summary = group ? summarizeGroup(group.services) : null
          const status: HealthStatus = summary
            ? summary.overall
            : (groupId === 'core-platform' ? model.platform : 'not_monitored')
          const impactText = impact[status] ?? impact.default

          return (
            <JourneyCard
              key={id}
              label={label}
              sub={sub}
              status={status}
              impactText={impactText}
              icon={icon}
            />
          )
        })}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// ACTIVE ISSUE RIBBON
// ─────────────────────────────────────────────────────────────

function IssueRibbon({ model }: { model: HealthDashboardModel }) {
  const issues = useMemo(() => getActiveIssues(model.groups), [model.groups])
  if (issues.length === 0) return null

  const hasDown = issues.some((i) => i.status === 'down')
  const t: Tone = hasDown ? 'danger' : 'warning'
  const cls = T[t]

  return (
    <div
      className={`rounded-xl border ${cls.border} ${cls.bg} px-4 py-3 shadow-[var(--shadow-soft)]`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className={`size-4 shrink-0 ${cls.fg}`} />
        <span className={`text-sm font-bold tracking-tight ${cls.fg}`}>
          {issues.length === 1 ? '1 active issue' : `${issues.length} active issues`}
        </span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {issues.map((issue) => (
          <li key={issue.id} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${cls.dot}`} />
            <div className="min-w-0">
              <span className="font-semibold">{issue.name}</span>
              <span className="text-muted-foreground"> — Possible impact: {issue.impact}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SERVICE MATRIX (accordion)
// ─────────────────────────────────────────────────────────────

function ServiceRow({ service }: { service: HealthService }) {
  const cls = T[tone(service.status)]
  const isIssue = service.status === 'down' || service.status === 'degraded'

  const sourceLabel =
    service.source === 'not monitored'
      ? 'Not separately monitored'
      : service.source === 'derived'
        ? 'Derived from core health'
        : 'Live check'

  const impactLabel =
    service.status === 'unknown'
      ? "We're unable to confirm this check right now."
      : isIssue
        ? `Possible impact: ${service.impact}`
        : service.impact

  return (
    <li className={`rounded-lg border px-3 py-2.5 ${isIssue ? `${cls.bg} ${cls.border}` : 'border-border/40 bg-muted/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold leading-tight">{service.name}</p>
          <p className="text-xs italic leading-snug text-muted-foreground">{impactLabel}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40">
            {sourceLabel}
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <StatusPill status={service.status} />
        </div>
      </div>
    </li>
  )
}

function ServiceGroupAccordion({ group }: { group: HealthServiceGroup }) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => summarizeGroup(group.services), [group.services])
  const cls = T[tone(summary.overall)]
  const hasIssues = summary.down > 0 || summary.degraded > 0

  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
      >
        {/* Status icon */}
        <StatusIcon status={summary.overall} className="size-4 shrink-0" />

        {/* Group name */}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</span>

        {/* Issue flag */}
        {hasIssues && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${T[summary.down > 0 ? 'danger' : 'warning'].bg} ${T[summary.down > 0 ? 'danger' : 'warning'].fg} ${T[summary.down > 0 ? 'danger' : 'warning'].border} border`}>
            {summary.down > 0 ? 'Outage' : 'Degraded'}
          </span>
        )}

        {/* Count chips — desktop only */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {summary.operational > 0 && (
            <span className="font-mono text-[10px] text-[var(--tone-success-fg)]">
              {summary.operational}↑
            </span>
          )}
          {summary.degraded > 0 && (
            <span className="font-mono text-[10px] text-[var(--tone-warning-fg)]">
              {summary.degraded}~
            </span>
          )}
          {summary.down > 0 && (
            <span className="font-mono text-[10px] text-[var(--tone-danger-fg)]">
              {summary.down}↓
            </span>
          )}
          {summary.notMonitored > 0 && (
            <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/50">
              <EyeOff className="size-2.5" />
              {summary.notMonitored}
            </span>
          )}
        </div>

        {/* Status pill */}
        <StatusPill status={summary.overall} />

        {/* Chevron */}
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-border/40 bg-muted/5 px-3 pb-3 pt-2">
          <ul className="space-y-1.5">
            {group.services.map((service) => (
              <ServiceRow key={service.id} service={service} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ServiceMatrix({ model }: { model: HealthDashboardModel }) {
  return (
    <section aria-label="Service detail matrix">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Service Detail
      </p>
      <div className="space-y-2">
        {model.groups.map((group) => (
          <ServiceGroupAccordion key={group.id} group={group} />
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// BUILD METADATA BAR
// ─────────────────────────────────────────────────────────────

function BuildBar({ model }: { model: HealthDashboardModel }) {
  const { build } = model
  const hasBuild = build.commitShaShort ?? build.commitRef ?? build.builtAt

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border/40 bg-muted/10 px-4 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        <Shield className="size-3 shrink-0" />
        Build
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
        API:
        <span className={`ml-1 font-mono font-semibold ${T[tone(model.healthEndpoint)].fg}`}>
          {STATUS_LABELS[model.healthEndpoint]}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
        DB:
        <span className={`ml-1 font-mono font-semibold ${T[tone(model.database)].fg}`}>
          {STATUS_LABELS[model.database]}
        </span>
      </div>
      {hasBuild && build.commitShaShort ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
          <GitBranch className="size-3 shrink-0" />
          <span className="font-mono">
            {build.commitShaShort}
            {build.commitRef ? ` (${build.commitRef})` : ''}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-muted-foreground/40">
          <EyeOff className="size-3 shrink-0" />
          <span>Build metadata unavailable</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────

function StatusFooter({ asOf }: { asOf: string }) {
  return (
    <footer className="pb-2 pt-1 text-center text-[11px] text-muted-foreground/40">
      <p>Public visibility only — no customer or provider data is shown.</p>
      <p className="mt-0.5">Last checked: {formatDate(asOf)} · Public-only health checks</p>
    </footer>
  )
}

// ─────────────────────────────────────────────────────────────
// LOADING SKELETON
// ─────────────────────────────────────────────────────────────

function StatusSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:px-6">
      <div className="h-32 animate-pulse rounded-2xl bg-muted/20" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl bg-muted/20" />
        ))}
      </div>
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/20" />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export function StatusDashboard() {
  const [model, setModel] = useState<HealthDashboardModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL_S)

  const loadHealth = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Health endpoint returned ${res.status}`)
      const payload = await res.json() as unknown
      setModel(normalizeHealthPayload(payload))
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error'
      setModel(buildFallbackHealthModel(reason))
      setLoadError(reason)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRefresh = useCallback(() => {
    setCountdown(AUTO_REFRESH_INTERVAL_S)
    void loadHealth()
  }, [loadHealth])

  // Initial load
  useEffect(() => { void loadHealth() }, [loadHealth])

  // Auto-refresh countdown
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void loadHealth()
          return AUTO_REFRESH_INTERVAL_S
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [loadHealth])

  if (loading && !model) return <StatusSkeleton />
  if (!model) return null

  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
      <HeroStatusBanner
        model={model}
        onRefresh={handleRefresh}
        loading={loading}
        countdown={countdown}
        error={loadError}
      />
      <JourneyHealthStrip model={model} />
      <IssueRibbon model={model} />
      <ServiceMatrix model={model} />
      <BuildBar model={model} />
      <StatusFooter asOf={model.asOf} />
    </main>
  )
}
