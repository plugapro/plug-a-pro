'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, BotMessageSquare, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/shared/ErrorState'
import { CardSkeleton, StatGridSkeleton } from '@/components/shared/LoadingSkeleton'
import {
  HEALTH_STATUS_LABELS,
  type HealthServiceGroup,
  type HealthStatus,
  type PublicHealthModel,
  healthForUnavailableEndpoint,
  normalizeHealthResponse,
} from '@/lib/status/health-model'

const REFRESH_LABEL = 'Refresh status'
const UNSAFE_HEALTH_MESSAGE = 'I could not reach the health endpoint right now.'

function statusTone(status: HealthStatus) {
  if (status === 'operational') return 'success'
  if (status === 'degraded') return 'warning'
  if (status === 'down') return 'danger'
  if (status === 'not_monitored') return 'neutral'
  return 'neutral'
}

function formatLastChecked(timestamp: string | null) {
  if (!timestamp) return 'Not available'
  const value = new Date(timestamp)
  if (Number.isNaN(value.getTime())) return 'Not available'
  return value.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortSummary(group: HealthServiceGroup) {
  if (group.status === 'not_monitored') {
    return `${group.counts.notMonitored} checks not separately monitored`
  }

  if (group.counts.operational > 0 && group.counts.operational === group.checks.length) {
    return `All ${group.counts.operational} checks running`
  }

  const parts: string[] = []
  if (group.counts.operational) parts.push(`${group.counts.operational} running`)
  if (group.counts.degraded) parts.push(`${group.counts.degraded} degraded`)
  if (group.counts.down) parts.push(`${group.counts.down} not running`)
  if (group.counts.unknown) parts.push(`${group.counts.unknown} unknown`)
  if (group.counts.notMonitored) parts.push(`${group.counts.notMonitored} inferred only`)
  return parts.join(' · ')
}

function summarizeStatusFromGroups(groups: Array<HealthServiceGroup | undefined>): HealthStatus {
  const observed = groups
    .flatMap((group) => (group ? group.checks : []))
    .filter((check) => check.source !== 'not_monitored')
    .map((check) => check.status)

  if (observed.length === 0) return 'not_monitored'
  if (observed.includes('down')) return 'down'
  if (observed.includes('degraded')) return 'degraded'
  if (observed.includes('unknown')) return 'unknown'
  return 'operational'
}

function buildServiceLookup(groups: HealthServiceGroup[]) {
  return Object.fromEntries(groups.map((group) => [group.id, group])) as Record<string, HealthServiceGroup>
}

type DashboardState =
  | { status: 'loading' }
  | { status: 'ready'; payload: PublicHealthModel }
  | { status: 'error'; payload: PublicHealthModel; message: string }

export function StatusDashboard() {
  const [state, setState] = useState<DashboardState>({ status: 'loading' })

  // Keep one network call per mount/refresh and always use a deterministic fallback
  // model so the page never crashes on malformed backend data.
  const loadHealth = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })

      let rawPayload: unknown = null
      try {
        rawPayload = await response.json()
      } catch {
        rawPayload = null
      }

      if (typeof rawPayload === 'object' && rawPayload !== null) {
        // Keep the endpoint response as a source of truth for known checks.
        setState({
          status: 'ready',
          payload: normalizeHealthResponse(rawPayload),
        })
        return
      }

      const reason = `invalid response (HTTP ${response.status})`
      setState({
        status: 'error',
        message: UNSAFE_HEALTH_MESSAGE,
        payload: healthForUnavailableEndpoint(reason),
      })
    } catch {
      // Network / platform issue: fallback model keeps the UI safe and public.
      setState({
        status: 'error',
        message: UNSAFE_HEALTH_MESSAGE,
        payload: healthForUnavailableEndpoint('network error'),
      })
    }
  }, [])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  if (state.status === 'loading') {
    return (
      <main className="min-h-screen">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:py-10">
          <section className="app-hero-surface rounded-3xl px-5 py-6 sm:px-7 sm:py-8">
            <div className="mb-6 space-y-2">
              <p className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Activity className="size-3.5" />
                Public Service Status
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
                Plug-A-Pro Service Status
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Live visibility into the health of core Plug-A-Pro user journeys.
              </p>
            </div>
            <StatGridSkeleton count={4} />
          </section>
          <CardSkeleton className="h-72" />
        </div>
      </main>
    )
  }

  const payload = state.status === 'loading' ? null : state.payload
  if (!payload) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <ErrorState
          title="Health data unavailable"
          description={UNSAFE_HEALTH_MESSAGE}
          retry={
            <Button onClick={() => void loadHealth()} type="button">
              <RefreshCw className="mr-1.5 size-4" />
              {REFRESH_LABEL}
            </Button>
          }
        />
      </main>
    )
  }

  const groups = buildServiceLookup(payload.serviceGroups)

  const clientGroup = groups['client-journey']
  const providerGroup = groups['provider-journey']
  const merchantGroup = groups['merchant-journey']
  const corePlatformGroup = groups['core-platform']
  const platformOperationsStatus = summarizeStatusFromGroups([
    corePlatformGroup,
    groups.auth,
    groups.notifications,
    groups['admin-operations'],
  ])

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:py-10">
        <section className="app-hero-surface rounded-3xl px-5 py-6 sm:px-7 sm:py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Activity className="size-3.5" />
                Public Service Status
              </p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">
                Plug-A-Pro Service Status
              </h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                Live visibility into the health of core Plug-A-Pro user journeys.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => void loadHealth()} variant="outline" type="button">
                <RefreshCw className="mr-1.5 size-4" />
                {REFRESH_LABEL}
              </Button>
              <Button asChild>
                <Link href="/">Home</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-2xl border border-success/30 bg-success/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-success-foreground">
                  Overall platform status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {HEALTH_STATUS_LABELS[payload.overallStatus]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last checked {formatLastChecked(payload.lastCheckedAt)}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-info/30 bg-info/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-info-foreground">
                  Client journey
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {HEALTH_STATUS_LABELS[clientGroup?.status ?? 'not_monitored']}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {clientGroup ? shortSummary(clientGroup) : 'Not available'}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-warning/30 bg-warning/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-warning-foreground">
                  Provider journey
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {HEALTH_STATUS_LABELS[providerGroup?.status ?? 'not_monitored']}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {providerGroup ? shortSummary(providerGroup) : 'Not available'}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-brand/30 bg-brand/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-brand-foreground">
                  Merchant journey
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {HEALTH_STATUS_LABELS[merchantGroup?.status ?? 'not_monitored']}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {merchantGroup ? shortSummary(merchantGroup) : 'Not available'}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-primary/30 bg-primary/10 sm:col-span-2 xl:col-span-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Platform operations</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{HEALTH_STATUS_LABELS[platformOperationsStatus]}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Includes core platform, auth, notifications, and admin services.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {state.status === 'error' && (
          <ErrorState
            title="Health endpoint issue"
            description={state.message}
            retry={
              <Button onClick={() => void loadHealth()} variant="outline" type="button">
                <RefreshCw className="mr-1.5 size-4" />
                Retry
              </Button>
            }
          />
        )}

        <section className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>Plug-A-Pro Bot</CardTitle>
              <CardDescription>Plain-language platform summary</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/8 p-4">
                <BotMessageSquare className="mt-0.5 size-5 text-primary" />
                <p className="text-sm leading-6 text-foreground">{payload.robotMessage}</p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Last checked: {formatLastChecked(payload.lastCheckedAt)}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>Build &amp; Diagnostics</CardTitle>
              <CardDescription>Derived from `/api/health` metadata</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">Commit SHA (short)</p>
                <p className="font-mono text-sm">{payload.build.commitShaShort ?? 'Unavailable'}</p>
              </div>
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">Branch / ref</p>
                <p className="font-mono text-sm">{payload.build.commitRef ?? 'Unavailable'}</p>
              </div>
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">Build timestamp</p>
                <p className="font-mono text-sm">{payload.build.builtAt ?? 'Unavailable'}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                No customer or provider personal data is exposed on this page.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {payload.serviceGroups.map((group) => (
            <Card key={group.id} className="rounded-3xl">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{group.title}</CardTitle>
                    <CardDescription className="mt-1">{group.description}</CardDescription>
                  </div>
                  <Badge variant={statusTone(group.status)}>{HEALTH_STATUS_LABELS[group.status]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {group.checks.map((check) => (
                  <div key={check.id} className="rounded-2xl border bg-card/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{check.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{check.impact}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant={statusTone(check.status)}>{HEALTH_STATUS_LABELS[check.status]}</Badge>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {check.source}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="rounded-3xl border border-warning/30 bg-warning/10">
          <CardContent className="pt-6 text-xs text-muted-foreground">
            This page is for public service visibility. No customer or provider data is exposed.
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

