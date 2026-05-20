'use client'

import { cn } from '@/lib/utils'

export type TrendSeries = {
  key: string
  label: string
  points: { date: string; value: number }[]
}

const SERIES_COLORS: Record<string, string> = {
  requests: 'bg-blue-500',
  bookings: 'bg-emerald-500',
  completedJobs: 'bg-violet-500',
}

const LEGEND_COLORS: Record<string, string> = {
  requests: 'bg-blue-500',
  bookings: 'bg-emerald-500',
  completedJobs: 'bg-violet-500',
}

export function TrendChart({ series }: { series: TrendSeries[] }) {
  if (series.length === 0 || series[0].points.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
        No data for this range
      </div>
    )
  }

  const dates = series[0].points.map((p) => p.date)

  // Don't render a chart for a single data point - a number is clearer
  if (dates.length <= 1) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
        Select a wider range to see trends
      </div>
    )
  }

  const allValues = series.flatMap((s) => s.points.map((p) => p.value))
  const maxValue = Math.max(...allValues, 1)

  // Decide which date labels to show to avoid crowding
  const labelStep = dates.length <= 7 ? 1 : dates.length <= 14 ? 2 : Math.ceil(dates.length / 7)

  function formatLabel(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-full', LEGEND_COLORS[s.key] ?? 'bg-muted-foreground')} />
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="relative">
        {/* Bar area */}
        <div className="flex h-40 items-end gap-0.5">
          {dates.map((date, dateIdx) => (
            <div key={date} className="group relative flex flex-1 flex-col items-center justify-end gap-0.5" style={{ minWidth: 0 }}>
              {/* Bars stacked side by side per day */}
              <div className="flex w-full items-end justify-center gap-px">
                {series.map((s) => {
                  const point = s.points[dateIdx]
                  const pct = point ? (point.value / maxValue) * 100 : 0
                  return (
                    <div
                      key={s.key}
                      title={`${s.label}: ${point?.value ?? 0}`}
                      className={cn(
                        'flex-1 rounded-sm transition-opacity group-hover:opacity-90',
                        SERIES_COLORS[s.key] ?? 'bg-muted-foreground',
                        pct === 0 ? 'opacity-10' : '',
                      )}
                      style={{ height: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Date labels */}
        <div className="mt-2 flex gap-0.5">
          {dates.map((date, i) => (
            <div key={date} className="flex-1 text-center" style={{ minWidth: 0 }}>
              {i % labelStep === 0 && (
                <span className="text-[10px] text-muted-foreground">{formatLabel(date)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
