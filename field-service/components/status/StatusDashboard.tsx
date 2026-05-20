'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  HelpCircle,
  MessageCircle,
  RefreshCw,
  Search,
  UserCheck,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  buildFallbackHealthModel,
  normalizeHealthPayload,
  STATUS_LABELS,
  statusToneFromCheck,
  type HealthDashboardModel,
  type HealthStatus,
} from '@/lib/status/health'

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const AUTO_REFRESH_INTERVAL_S = 30

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

function tone(status: HealthStatus): Tone {
  return statusToneFromCheck[status]
}

// Tailwind classes keyed by tone
const T = {
  success: {
    bg: 'bg-[var(--tone-success-bg)]',
    border: 'border-[var(--tone-success-border)]',
    fg: 'text-[var(--tone-success-fg)]',
    dot: 'bg-[var(--tone-success-fg)]',
    borderL: 'border-l-[var(--tone-success-fg)]',
  },
  warning: {
    bg: 'bg-[var(--tone-warning-bg)]',
    border: 'border-[var(--tone-warning-border)]',
    fg: 'text-[var(--tone-warning-fg)]',
    dot: 'bg-[var(--tone-warning-fg)]',
    borderL: 'border-l-[var(--tone-warning-fg)]',
  },
  danger: {
    bg: 'bg-[var(--tone-danger-bg)]',
    border: 'border-[var(--tone-danger-border)]',
    fg: 'text-[var(--tone-danger-fg)]',
    dot: 'bg-[var(--tone-danger-fg)]',
    borderL: 'border-l-[var(--tone-danger-fg)]',
  },
  neutral: {
    bg: 'bg-[var(--tone-neutral-bg)]',
    border: 'border-[var(--tone-neutral-border)]',
    fg: 'text-[var(--tone-neutral-fg)]',
    dot: 'bg-[var(--tone-neutral-fg)]',
    borderL: 'border-l-[var(--tone-neutral-fg)]',
  },
} satisfies Record<Tone, Record<string, string>>

// User-friendly status labels for the public page
const USER_STATUS_LABELS: Record<HealthStatus, string> = {
  operational: 'Running smoothly',
  degraded: 'Slower than usual',
  down: 'Currently unavailable',
  unknown: 'Checking status…',
  not_monitored: 'Running smoothly',
}

// User-friendly headline labels
function headlineFor(status: HealthStatus): string {
  switch (status) {
    case 'operational': return 'Everything is running'
    case 'degraded': return 'Some things are slower than usual'
    case 'down': return "We're experiencing an issue"
    default: return 'Checking platform status…'
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-ZA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Treat not_monitored as operational on the public page - don't expose monitoring gaps
function publicStatus(status: HealthStatus): HealthStatus {
  return status === 'not_monitored' ? 'operational' : status
}

// ─────────────────────────────────────────────────────────────
// JOURNEY DEFINITIONS
// ─────────────────────────────────────────────────────────────

type StatusKey = 'platform' | 'whatsapp' | 'payments'

const JOURNEYS: {
  id: string
  icon: ComponentType<{ className?: string }>
  label: string
  description: string
  statusKey: StatusKey
}[] = [
  {
    id: 'find-pro',
    icon: Search,
    label: 'Find a Pro',
    description: 'Search and browse service providers near you',
    statusKey: 'platform',
  },
  {
    id: 'book-service',
    icon: Calendar,
    label: 'Book a Service',
    description: 'Request a job, get quotes and track your booking',
    statusKey: 'platform',
  },
  {
    id: 'whatsapp-updates',
    icon: MessageCircle,
    label: 'WhatsApp Updates',
    description: 'Receive booking confirmations and job updates via WhatsApp',
    statusKey: 'whatsapp',
  },
  {
    id: 'payments',
    icon: CreditCard,
    label: 'Payments & Receipts',
    description: 'Pay for services and receive your invoice',
    statusKey: 'payments',
  },
  {
    id: 'provider-signup',
    icon: UserCheck,
    label: 'Join as a Provider',
    description: 'Register as a service provider and get approved',
    statusKey: 'platform',
  },
  {
    id: 'job-matching',
    icon: Zap,
    label: 'Job Matching',
    description: 'Get matched with the right provider for your request',
    statusKey: 'platform',
  },
]

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
    case 'operational':
    case 'not_monitored':
      return <CheckCircle2 className={`${className} ${cls.fg}`} />
    case 'degraded':
      return <AlertTriangle className={`${className} ${cls.fg}`} />
    case 'down':
      return <XCircle className={`${className} ${cls.fg}`} />
    default:
      return <HelpCircle className={`${className} ${cls.fg}`} />
  }
}

// ─────────────────────────────────────────────────────────────
// HERO BANNER
// ─────────────────────────────────────────────────────────────

function HeroBanner({
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
      <div className="relative px-5 py-5 sm:px-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="app-kicker text-muted-foreground/60">Plug A Pro · Service Status</p>
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

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <Clock className="size-3 shrink-0" />
            {formatDate(model.asOf)}
          </span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <span className="flex items-center gap-1">
            <Bot className="size-3 shrink-0" />
            Plug A Pro Bot
          </span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <span>Auto-refresh every {AUTO_REFRESH_INTERVAL_S}s</span>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--tone-warning-fg)]" />
            <span className="font-semibold text-[var(--tone-warning-fg)]">Could not refresh - showing last known status.</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// JOURNEY GRID
// ─────────────────────────────────────────────────────────────

function JourneyCard({
  icon: Icon,
  label,
  description,
  status,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  description: string
  status: HealthStatus
}) {
  const effective = publicStatus(status)
  const cls = T[tone(effective)]
  const isIssue = effective === 'down' || effective === 'degraded'

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border px-4 py-4 shadow-[var(--shadow-soft)] ${isIssue ? `${cls.bg} ${cls.border}` : 'bg-card border-border/60'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-tight truncate">{label}</span>
        </div>
        <StatusIcon status={effective} className="size-4 shrink-0" />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      <span className={`text-[11px] font-semibold ${cls.fg}`}>
        {USER_STATUS_LABELS[effective]}
      </span>
    </div>
  )
}

function JourneyGrid({ model }: { model: HealthDashboardModel }) {
  return (
    <section aria-label="Service journey status">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Service Status
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {JOURNEYS.map(({ id, icon, label, description, statusKey }) => (
          <JourneyCard
            key={id}
            icon={icon}
            label={label}
            description={description}
            status={model[statusKey]}
          />
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────

function StatusFooter({ asOf }: { asOf: string }) {
  return (
    <footer className="pb-2 pt-1 text-center text-[11px] text-muted-foreground/40">
      <p>Public status only - no customer or provider data is shown.</p>
      <p className="mt-0.5">Last checked: {formatDate(asOf)}</p>
    </footer>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────

function StatusSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:px-6">
      <div className="h-32 animate-pulse rounded-2xl bg-muted/20" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted/20" />
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

  // Avoid direct sync call warning; refresh is async and intentionally side-effectful.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadHealth() }, [loadHealth])

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
      <HeroBanner
        model={model}
        onRefresh={handleRefresh}
        loading={loading}
        countdown={countdown}
        error={loadError}
      />
      <JourneyGrid model={model} />
      <StatusFooter asOf={model.asOf} />
    </main>
  )
}
