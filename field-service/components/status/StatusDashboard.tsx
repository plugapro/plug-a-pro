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
  ChevronUp,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

// ——— STATUS UTILITIES ———

function statusDotClass(status: HealthStatus): string {
  switch (status) {
    case 'operational': return 'bg-[var(--tone-success-fg)]'
    case 'degraded': return 'bg-[var(--tone-warning-fg)]'
    case 'down': return 'bg-[var(--tone-danger-fg)]'
    default: return 'bg-[var(--tone-neutral-fg)]'
  }
}

function statusBadgeVariant(status: HealthStatus) {
  return statusToneFromCheck[status]
}

function statusIcon(status: HealthStatus, className = 'size-4') {
  switch (status) {
    case 'operational':
      return <CheckCircle2 className={`${className} text-[var(--tone-success-fg)]`} />
    case 'degraded':
      return <AlertCircle className={`${className} text-[var(--tone-warning-fg)]`} />
    case 'down':
      return <XCircle className={`${className} text-[var(--tone-danger-fg)]`} />
    default:
      return <HelpCircle className={`${className} text-[var(--tone-neutral-fg)]`} />
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-ZA', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ——— JOURNEY DEFINITIONS ———

const JOURNEY_DEFS: {
  id: string
  groupId: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}[] = [
  { id: 'client', groupId: 'client-journey', label: 'Client Journey', description: 'Track booking, request creation, provider browsing', icon: Users },
  { id: 'provider', groupId: 'provider-journey', label: 'Provider Journey', description: 'Leads, jobs, portal and availability', icon: Wrench },
  { id: 'merchant', groupId: 'merchant-journey', label: 'Merchant / Commercial', description: 'Quoting, payments, invoicing', icon: Building2 },
  { id: 'ops', groupId: 'core-platform', label: 'Platform Operations', description: 'Core services and monitoring', icon: Activity },
]

const AUTO_REFRESH_INTERVAL_S = 30

// ——— STATUS HEADER ———

function StatusHeader({
  onRefresh,
  loading,
  countdown,
}: {
  onRefresh: () => void
  loading: boolean
  countdown: number
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-0.5">
        <p className="app-kicker">Plug-A-Pro</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Plug-A-Pro Public Service Status
        </h1>
        <p className="text-sm text-muted-foreground">
          Live visibility into Plug-A-Pro platform health and journeys.
        </p>
      </div>
      <Button
        onClick={onRefresh}
        disabled={loading}
        size="sm"
        variant="outline"
        className="shrink-0"
      >
        <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Refreshing…' : `Refresh (${countdown}s)`}
      </Button>
    </div>
  )
}

// ——— OVERALL STATUS CARD ———

function OverallStatusCard({ model }: { model: HealthDashboardModel }) {
  const status = model.overall
  const variant = statusBadgeVariant(status)

  const borderLeft: Record<typeof variant, string> = {
    success: 'border-l-[var(--tone-success-fg)]',
    warning: 'border-l-[var(--tone-warning-fg)]',
    danger: 'border-l-[var(--tone-danger-fg)]',
    neutral: 'border-l-[var(--tone-neutral-fg)]',
  }
  const bg: Record<typeof variant, string> = {
    success: 'bg-[var(--tone-success-bg)]',
    warning: 'bg-[var(--tone-warning-bg)]',
    danger: 'bg-[var(--tone-danger-bg)]',
    neutral: 'bg-[var(--tone-neutral-bg)]',
  }
  const shouldPulse = status === 'operational' || status === 'down'

  return (
    <div
      className={`rounded-2xl border border-l-4 ${borderLeft[variant]} ${bg[variant]} p-4 shadow-[var(--shadow-soft)]`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Animated status dot */}
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span
              className={`absolute inline-flex size-full rounded-full opacity-40 ${statusDotClass(status)} ${shouldPulse ? 'animate-pulse' : ''}`}
            />
            <span className={`relative inline-flex size-2.5 rounded-full ${statusDotClass(status)}`} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold tracking-tight">{STATUS_LABELS[status]}</span>
              <Badge variant={variant} className="text-xs">Overall</Badge>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              Last checked: {formatDate(model.asOf)}
            </div>
          </div>
        </div>
        {statusIcon(status, 'size-8 opacity-50')}
      </div>
    </div>
  )
}

// ——— BOT SUMMARY BANNER ———

function BotSummaryBanner({ message, error }: { message: string; error: string | null }) {
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border/80 bg-card/90 p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface-subtle">
            <Bot className="size-4 text-brand-strong" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Plug-A-Pro Bot</p>
            <p className="mt-0.5 text-sm sm:text-base">{message}</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--tone-warning-fg)]" />
          <div>
            <p className="font-medium text-[var(--tone-warning-fg)]">Last refresh was not clean.</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ——— JOURNEY HEALTH STRIP ———

function JourneyHealthCard({
  label,
  description,
  status,
  icon: Icon,
}: {
  label: string
  description: string
  status: HealthStatus
  icon: ComponentType<{ className?: string }>
}) {
  const variant = statusBadgeVariant(status)
  const cardBg: Record<typeof variant, string> = {
    success: 'bg-[var(--tone-success-bg)] border-[var(--tone-success-border)]',
    warning: 'bg-[var(--tone-warning-bg)] border-[var(--tone-warning-border)]',
    danger: 'bg-[var(--tone-danger-bg)] border-[var(--tone-danger-border)]',
    neutral: 'bg-card border-border/80',
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 shadow-[var(--shadow-soft)] ${cardBg[variant]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium leading-tight">{label}</span>
        </div>
        {statusIcon(status, 'size-4 shrink-0')}
      </div>
      <p className="text-xs leading-snug text-muted-foreground">{description}</p>
      <div className="mt-auto pt-1">
        <Badge variant={variant} className="text-xs">{STATUS_LABELS[status]}</Badge>
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
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Journey Health
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {JOURNEY_DEFS.map(({ id, groupId, label, description, icon }) => {
          const group = groupMap[groupId]
          const summary = group ? summarizeGroup(group.services) : null
          const status: HealthStatus = summary
            ? summary.overall
            : (groupId === 'core-platform' ? model.platform : 'not_monitored')

          return (
            <JourneyHealthCard
              key={id}
              label={label}
              description={description}
              status={status}
              icon={icon}
            />
          )
        })}
      </div>
    </div>
  )
}

// ——— ISSUE RIBBON ———

function IssueRibbon({ model }: { model: HealthDashboardModel }) {
  const issues = useMemo(() => getActiveIssues(model.groups), [model.groups])
  if (issues.length === 0) return null

  const hasDown = issues.some((i) => i.status === 'down')
  const tone = hasDown
    ? { border: 'border-[var(--tone-danger-border)]', bg: 'bg-[var(--tone-danger-bg)]', fg: 'text-[var(--tone-danger-fg)]', dot: 'bg-[var(--tone-danger-fg)]' }
    : { border: 'border-[var(--tone-warning-border)]', bg: 'bg-[var(--tone-warning-bg)]', fg: 'text-[var(--tone-warning-fg)]', dot: 'bg-[var(--tone-warning-fg)]' }

  return (
    <div className={`rounded-xl border ${tone.border} ${tone.bg} p-3 shadow-[var(--shadow-soft)]`}>
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className={`size-4 shrink-0 ${tone.fg}`} />
        <span className={`text-sm font-semibold ${tone.fg}`}>
          {issues.length === 1 ? '1 active issue detected' : `${issues.length} active issues detected`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {issues.map((issue) => (
          <li key={issue.id} className="flex items-start gap-2">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone.dot}`} />
            <div className="text-sm">
              <span className="font-medium">{issue.name}</span>
              {' — '}
              <span className="text-muted-foreground">Possible impact: {issue.impact}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ——— SERVICE MATRIX ———

const TOP_N = 4

function ServiceRow({ service }: { service: HealthService }) {
  const variant = statusBadgeVariant(service.status)
  const isIssue = service.status === 'down' || service.status === 'degraded'
  const isUnknown = service.status === 'unknown'

  const sourceCopy =
    service.source === 'not monitored'
      ? 'Not separately monitored'
      : service.source === 'derived'
        ? 'Derived from core health'
        : 'Live check'

  const impactCopy = isUnknown
    ? "We're unable to confirm this check right now."
    : isIssue
      ? `Possible impact: ${service.impact}`
      : service.impact

  return (
    <li
      className={`rounded-lg border p-2.5 ${
        isIssue
          ? 'border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]/50'
          : 'border-border/60 bg-muted/20'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-medium leading-snug">{service.name}</p>
          <p className="text-xs leading-snug text-muted-foreground">{impactCopy}</p>
          <p className="text-xs leading-snug text-muted-foreground/60">{sourceCopy}</p>
        </div>
        <Badge variant={variant} className="mt-0.5 shrink-0 text-xs">
          {STATUS_LABELS[service.status]}
        </Badge>
      </div>
    </li>
  )
}

function ServiceGroupCard({ group }: { group: HealthServiceGroup }) {
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => summarizeGroup(group.services), [group.services])
  const topServices = group.services.slice(0, TOP_N)
  const remaining = group.services.slice(TOP_N)

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-snug">{group.name}</CardTitle>
          {statusIcon(summary.overall, 'size-4 shrink-0 mt-0.5')}
        </div>

        {/* Status count chips */}
        <div className="flex flex-wrap gap-1.5">
          {summary.operational > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] px-2 py-0.5 text-xs text-[var(--tone-success-fg)]">
              <span className="size-1.5 rounded-full bg-[var(--tone-success-fg)]" />
              {summary.operational} running
            </span>
          )}
          {summary.degraded > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-2 py-0.5 text-xs text-[var(--tone-warning-fg)]">
              <span className="size-1.5 rounded-full bg-[var(--tone-warning-fg)]" />
              {summary.degraded} degraded
            </span>
          )}
          {summary.down > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] px-2 py-0.5 text-xs text-[var(--tone-danger-fg)]">
              <span className="size-1.5 rounded-full bg-[var(--tone-danger-fg)]" />
              {summary.down} down
            </span>
          )}
          {summary.unknown > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--tone-neutral-border)] bg-[var(--tone-neutral-bg)] px-2 py-0.5 text-xs text-[var(--tone-neutral-fg)]">
              <span className="size-1.5 rounded-full bg-[var(--tone-neutral-fg)]" />
              {summary.unknown} unknown
            </span>
          )}
          {summary.notMonitored > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
              <EyeOff className="size-2.5" />
              {summary.notMonitored} not separately monitored
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 pt-0">
        <ul className="space-y-2">
          {topServices.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </ul>

        {remaining.length > 0 && (
          <>
            {expanded && (
              <ul className="space-y-2">
                {remaining.map((service) => (
                  <ServiceRow key={service.id} service={service} />
                ))}
              </ul>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-8 w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? (
                <><ChevronUp className="size-3.5" />Show fewer</>
              ) : (
                <><ChevronDown className="size-3.5" />View all {group.services.length} services</>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ServiceMatrixSection({ model }: { model: HealthDashboardModel }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Service Matrix
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {model.groups.map((group) => (
          <ServiceGroupCard key={group.id} group={group} />
        ))}
      </div>
    </div>
  )
}

// ——— BUILD DIAGNOSTICS PANEL ———

function BuildDiagnosticsPanel({ model }: { model: HealthDashboardModel }) {
  const { build } = model
  const hasBuild = build.commitShaShort ?? build.commitRef ?? build.builtAt

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Shield className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Build &amp; Diagnostics
        </span>
      </div>
      <div className="grid gap-x-6 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-1.5">
          <Activity className="size-3 shrink-0" />
          <span>API: {STATUS_LABELS[model.healthEndpoint]}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="size-3 shrink-0" />
          <span>Database: {STATUS_LABELS[model.database]}</span>
        </div>
        {hasBuild ? (
          <>
            {build.commitShaShort && (
              <div className="flex items-center gap-1.5">
                <GitBranch className="size-3 shrink-0" />
                <span>
                  {build.commitShaShort}
                  {build.commitRef ? ` (${build.commitRef})` : ''}
                </span>
              </div>
            )}
            {build.builtAt && (
              <div className="flex items-center gap-1.5">
                <Clock className="size-3 shrink-0" />
                <span>Built: {build.builtAt}</span>
              </div>
            )}
          </>
        ) : (
          <div className="col-span-2 flex items-center gap-1.5">
            <EyeOff className="size-3 shrink-0" />
            <span>Build metadata not available</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ——— PUBLIC NOTICE FOOTER ———

function PublicNoticeFooter({ asOf }: { asOf: string }) {
  return (
    <footer className="rounded-xl border border-border/60 bg-surface-subtle/50 px-4 py-3 text-center text-xs text-muted-foreground">
      <p>This page is for public service visibility. No customer or provider data is exposed.</p>
      <p className="mt-1 opacity-70">
        Last checked: {formatDate(asOf)} · Public-only checks · Short commit ref only
      </p>
    </footer>
  )
}

// ——— LOADING STATE ———

function StatusLoadingState() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center gap-4 px-4 py-10">
      <div className="flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="size-5 animate-spin" />
        <span>Checking platform health…</span>
      </div>
      <div className="w-full max-w-sm space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/40" />
        ))}
      </div>
    </div>
  )
}

// ——— MAIN EXPORT ———

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
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
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

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void loadHealth()
          return AUTO_REFRESH_INTERVAL_S
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [loadHealth])

  if (loading && !model) return <StatusLoadingState />
  if (!model) return null

  return (
    <main className="mx-auto min-h-[100vh] max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <StatusHeader onRefresh={handleRefresh} loading={loading} countdown={countdown} />
      <OverallStatusCard model={model} />
      <BotSummaryBanner message={model.botMessage} error={loadError} />
      <JourneyHealthStrip model={model} />
      <IssueRibbon model={model} />
      <ServiceMatrixSection model={model} />
      <BuildDiagnosticsPanel model={model} />
      <PublicNoticeFooter asOf={model.asOf} />
    </main>
  )
}
