/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  buildFallbackHealthModel,
  normalizeHealthPayload,
  serviceStatusSummary,
  summarizeGroup,
  STATUS_LABELS,
  statusSourceLabel,
  statusToneFromCheck,
  type HealthDashboardModel,
  type HealthServiceGroup,
  type HealthStatus,
} from '@/lib/status/health'

function statusTone(status: HealthStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  return statusToneFromCheck[status]
}

function statusLabel(status: HealthStatus): string {
  return STATUS_LABELS[status]
}

function formatDate(value: string) {
  const valueAsDate = new Date(value)
  return valueAsDate.toLocaleString('en-ZA', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface OverviewCard {
  id: string
  title: string
  summary: string
  details: string
  status: HealthStatus
}

function resolveOverviewCards(model: HealthDashboardModel): OverviewCard[] {
  const groups = model.groups.reduce<Record<string, HealthServiceGroup>>(
    (acc, group) => {
      acc[group.id] = group
      return acc
    },
    {},
  )

  const summarize = (group: HealthServiceGroup) => {
    const summary = summarizeGroup(group.services)
    const status = summary.overall
    return {
      status,
      summary: `${summary.operational}/${summary.operational + summary.degraded + summary.down + summary.unknown + summary.notMonitored}`,
    }
  }

  const client = summarize(groups['client-journey'])
  const provider = summarize(groups['provider-journey'])
  const merchant = summarize(groups['merchant-journey'])

  return [
    {
      id: 'core',
      title: 'Platform Operations',
      summary: model.platform,
      details: `${statusLabel(model.platform)} across core services and health checks.`,
      status: model.platform,
    },
    {
      id: 'client',
      title: 'Client Journey',
      summary: client.summary,
      details: `Core health shows ${client.status}. ${groups['client-journey']?.name ?? 'Customer requests'}.`,
      status: client.status,
    },
    {
      id: 'provider',
      title: 'Provider Journey',
      summary: provider.summary,
      details: `Core health shows ${provider.status}. ${groups['provider-journey']?.name ?? 'Provider flows'}.`,
      status: provider.status,
    },
    {
      id: 'merchant',
      title: 'Merchant Journey',
      summary: merchant.summary,
      details: `Core health shows ${merchant.status}. ${groups['merchant-journey']?.name ?? 'Commercial controls'}.`,
      status: merchant.status,
    },
  ]
}

function OverallStatusPill({ status }: { status: HealthStatus }) {
  return (
    <Badge variant={statusTone(status)} className="px-3 py-1.5 text-sm">
      {statusLabel(status)}
    </Badge>
  )
}

function ServiceRow({
  service,
}: {
  service: {
    id: string
    name: string
    summary: string
    impact: string
    details: string
    status: HealthStatus
    source: 'live check' | 'derived' | 'not monitored'
  }
}) {
  return (
    <li className="rounded-xl border border-border/80 bg-card/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{service.name}</p>
          <p className="text-xs text-muted-foreground">{service.impact}</p>
          <p className="text-xs text-muted-foreground">
            Source: {statusSourceLabel[service.source]}
          </p>
          <p className="text-xs text-muted-foreground">{service.details}</p>
        </div>
        <Badge variant={statusTone(service.status)}>{service.summary}</Badge>
      </div>
    </li>
  )
}

function JourneyCard({ card }: { card: OverviewCard }) {
  return (
    <Card className="min-h-full">
      <CardHeader className="gap-2">
        <CardTitle className="text-base">{card.title}</CardTitle>
        <CardDescription>{card.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{card.details}</p>
        <Badge variant={statusTone(card.status)}>{statusLabel(card.status)}</Badge>
      </CardContent>
    </Card>
  )
}

function BuildPanel({
  model,
}: {
  model: HealthDashboardModel
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build & Diagnostics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          API health:
          {' '}
          {statusLabel(model.healthEndpoint)}
        </p>
        <p>
          Database:
          {' '}
          {statusLabel(model.database)}
        </p>
        <p>
          Build:
          {' '}
          {model.build.commitShaShort ?? 'N/A'}
          {model.build.commitRef ? ` (${model.build.commitRef})` : ''}
        </p>
        <p>Built at: {model.build.builtAt ?? 'Unavailable'}</p>
        <p>Last checked: {formatDate(model.asOf)}</p>
      </CardContent>
    </Card>
  )
}

export function StatusDashboard() {
  const [model, setModel] = useState<HealthDashboardModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadHealth = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`Health endpoint returned ${res.status}`)
      }
      const payload = await res.json()
      setModel(normalizeHealthPayload(payload))
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      setModel(buildFallbackHealthModel(reason))
      setLoadError(reason)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHealth().catch(() => {
      setModel(buildFallbackHealthModel('Health load failed'))
      setLoadError('Health load failed')
      setLoading(false)
    })
  }, [])

  const cards = useMemo(
    () => model ? resolveOverviewCards(model) : [],
    [model],
  )

  const robotMessage = model?.botMessage ?? 'Loading service status...'

  if (loading && !model) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="size-5 animate-spin" />
          <span>Loading health checks...</span>
        </div>
      </div>
    )
  }

  if (!model) {
    return null
  }

  return (
    <main className="mx-auto min-h-[100vh] max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="app-kicker">Plug-A-Pro</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Public Service Status
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Live visibility into the health of core Plug-A-Pro journeys.
            </p>
          </div>
          <OverallStatusPill status={model.overall} />
        </div>
        <div className="rounded-2xl border border-border/80 bg-card/90 p-4 shadow-[var(--shadow-soft)]">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bot className="size-5 text-brand-strong" />
              Plug-A-Pro Bot
            </div>
            <p className="text-sm text-muted-foreground sm:text-base">
              {robotMessage}
            </p>
          </div>
        </div>
        {loadError ? (
          <Card className="border-warning/40 bg-[var(--tone-warning-bg)]">
            <CardContent className="flex items-start gap-2 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>
                  Last refresh was not clean.
                </p>
                <p className="text-xs text-muted-foreground">
                  {loadError}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
        <div className="text-xs text-muted-foreground">
          Last checked:
          {' '}
          {formatDate(model.asOf)}
          {' '}
          ·
          {' '}
          Environment checks are public-only
          ·
          {' '}
          no raw commit SHA shown
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <JourneyCard key={card.id} card={card} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {model.groups.map((group) => {
          return (
            <Card key={group.id} className="space-y-3">
              <CardHeader className="gap-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <CardDescription>
                  {serviceStatusSummary(group.services)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-2">
                  {group.services.map((service) => (
                    <ServiceRow key={service.id} service={service} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <BuildPanel model={model} />
      <footer className="rounded-2xl border border-border/80 bg-surface-subtle/70 p-4 text-center text-xs text-muted-foreground">
        <p>
          This page is for public service visibility. No customer or provider data is exposed.
        </p>
      </footer>
      <div className="flex justify-end">
        <Button onClick={loadHealth} disabled={loading} size="sm" variant="outline">
          <RefreshCw className="size-4" />
          {loading ? 'Refreshing...' : 'Refresh status'}
        </Button>
      </div>
    </main>
  )
}
