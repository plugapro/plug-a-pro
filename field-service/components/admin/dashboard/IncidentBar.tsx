'use client'

import Link from 'next/link'
import { getQueueHref } from '@/lib/ops-dashboard/alerts'
import type { OpsDashboardIncident } from '@/lib/ops-dashboard/types'

function formatOldestAge(ageMinutes: number | undefined) {
  if (ageMinutes == null) return null
  if (ageMinutes < 60) return `${ageMinutes}m`
  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60
  if (hours < 24) return `${hours}h ${minutes}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

export function IncidentBar({ incidents }: { incidents: OpsDashboardIncident[] }) {
  if (incidents.length === 0) return null

  const hasBreach = incidents.some((incident) => incident.severity === 'danger')
  const ctaHref =
    incidents.length === 1 && incidents[0].queueKey
      ? getQueueHref(incidents[0].queueKey)
      : '/admin'

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        hasBreach
          ? 'border-danger/40 bg-danger/10 text-danger-foreground'
          : 'border-warning/40 bg-warning/10 text-warning-foreground'
      }`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">⚠</span>
          <span className="font-semibold">
            {incidents.length} active incident{incidents.length === 1 ? '' : 's'}
          </span>
          <span className="hidden text-current/70 lg:inline">·</span>
          <div className="flex flex-wrap items-center gap-2 text-current/90">
            {incidents.map((incident, index) => (
              <span key={incident.id}>
                {index > 0 ? ' · ' : ''}
                {incident.label ?? incident.message}
                {incident.label && incident.overdueCount != null && incident.oldestAgeMinutes != null
                  ? `: ${incident.overdueCount} item${incident.overdueCount === 1 ? '' : 's'} overdue (oldest ${formatOldestAge(incident.oldestAgeMinutes)})`
                  : ''}
              </span>
            ))}
          </div>
        </div>
        <Link
          href={ctaHref}
          className="text-xs font-medium underline underline-offset-4"
        >
          Open queues
        </Link>
      </div>
    </div>
  )
}
