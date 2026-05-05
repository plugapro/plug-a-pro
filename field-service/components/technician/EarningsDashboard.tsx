'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface EarningsData {
  currentMonth: {
    gross: number
    commission: number
    net: number
    pending: number
    paid: number
    jobs: {
      id: string
      category: string
      area: string
      completedAt: string
      gross: number
      net: number
    }[]
  }
  history: {
    month: string
    gross: number
    net: number
    paid: boolean
    payoutId: string | null
  }[]
}

const fmt = (v: number) => `R ${v.toFixed(2)}`

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function currentMonthLabel() {
  return new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

export function EarningsDashboard({ data }: { data: EarningsData }) {
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const { currentMonth, history } = data

  return (
    <div className="space-y-5">
      {/* Current month summary */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {currentMonthLabel()}
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross earned</span>
              <span>{fmt(currentMonth.gross)}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>Commission (15%)</span>
              <span>−{fmt(currentMonth.commission)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold text-base">
              <span>Net payout</span>
              <span>{fmt(currentMonth.net)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pending</span>
              <span>{fmt(currentMonth.pending)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Paid out</span>
              <span>{fmt(currentMonth.paid)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* This month's jobs */}
      {currentMonth.jobs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Jobs this month
          </p>
          <div className="space-y-1">
            {currentMonth.jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between text-sm py-2 border-b last:border-0"
              >
                <div>
                  <p className="font-medium">{job.category}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.area} &middot;{' '}
                    {new Date(job.completedAt).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{fmt(job.net)}</p>
                  <p className="text-xs text-muted-foreground">{fmt(job.gross)} gross</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentMonth.jobs.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No completed jobs this month yet.
        </p>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            History
          </p>
          <div className="space-y-1">
            {history.map((h) => (
              <div key={h.month} className="border rounded-lg">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-sm"
                  onClick={() =>
                    setOpenHistory(openHistory === h.month ? null : h.month)
                  }
                >
                  <span className="font-medium">{monthLabel(h.month)}</span>
                  <div className="flex items-center gap-3">
                    <span>{fmt(h.net)}</span>
                    <span
                      className={`text-xs font-medium ${
                        h.paid
                          ? 'text-[var(--tone-success-fg)]'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {h.paid ? 'Paid' : 'Pending'}
                    </span>
                    <span className="text-muted-foreground">
                      {openHistory === h.month ? '▲' : '▼'}
                    </span>
                  </div>
                </button>
                {openHistory === h.month && (
                  <div className="px-4 pb-3 pt-0 border-t">
                    <div className="space-y-1 text-xs text-muted-foreground py-2">
                      <div className="flex justify-between">
                        <span>Gross</span>
                        <span>{fmt(h.gross)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Commission</span>
                        <span>−{fmt(h.gross - h.net)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-foreground pt-1 border-t">
                        <span>Net</span>
                        <span>{fmt(h.net)}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 text-xs"
                      onClick={() => {
                        window.open(
                          `/api/technician/earnings/statement?month=${h.month}`,
                          '_blank'
                        )
                      }}
                    >
                      ↓ Download Statement
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">
        Plug A Pro charges 15% commission on gross earnings. This covers platform fees, payment
        processing, and customer acquisition.
      </p>
    </div>
  )
}
