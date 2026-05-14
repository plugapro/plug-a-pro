// Provider: Earnings dashboard
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { ChevronLeft } from 'lucide-react'
import { EarningsDashboard } from '@/components/technician/EarningsDashboard'

export const metadata = buildMetadata({ title: 'Earnings', noIndex: true })

interface EarningsData {
  currentMonth: {
    gross: number
    commission: number
    net: number
    pending: number
    paid: number
    jobs: { id: string; category: string; area: string; completedAt: string; gross: number; net: number }[]
  }
  history: { month: string; gross: number; net: number; paid: boolean; payoutId: string | null }[]
}

export default async function EarningsPage() {
  const session = await requireProvider()
  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const allPayouts = await db.providerPayout.findMany({
    where: { providerId: provider.id },
    include: {
      job: {
        include: {
          booking: {
            include: {
              match: { include: { jobRequest: { include: { address: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const currentPayouts = allPayouts.filter(
    (p) => p.createdAt >= monthStart && p.createdAt <= monthEnd
  )

  const sumField = (
    arr: typeof allPayouts,
    f: 'grossAmount' | 'commissionAmt' | 'netAmount'
  ) => arr.reduce((acc, p) => acc + Number(p[f]), 0)

  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const historyMap = new Map<
    string,
    { gross: number; net: number; paid: boolean; payoutId: string | null }
  >()
  for (const p of allPayouts) {
    const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`
    const entry = historyMap.get(key)
    if (!entry) {
      historyMap.set(key, {
        gross: Number(p.grossAmount),
        net: Number(p.netAmount),
        paid: p.status === 'PAID',
        payoutId: p.id,
      })
    } else {
      entry.gross += Number(p.grossAmount)
      entry.net += Number(p.netAmount)
      if (p.status !== 'PAID') entry.paid = false
    }
  }

  const data: EarningsData = {
    currentMonth: {
      gross: sumField(currentPayouts, 'grossAmount'),
      commission: sumField(currentPayouts, 'commissionAmt'),
      net: sumField(currentPayouts, 'netAmount'),
      pending: currentPayouts
        .filter((p) => p.status !== 'PAID')
        .reduce((a, p) => a + Number(p.netAmount), 0),
      paid: currentPayouts
        .filter((p) => p.status === 'PAID')
        .reduce((a, p) => a + Number(p.netAmount), 0),
      jobs: currentPayouts.map((p) => ({
        id: p.job.id,
        category: p.job.booking.match.jobRequest.category,
        area: p.job.booking.match.jobRequest.address?.suburb ?? 'Unknown',
        completedAt: (p.job.completedAt ?? p.createdAt).toISOString(),
        gross: Number(p.grossAmount),
        net: Number(p.netAmount),
      })),
    },
    history: [...historyMap.entries()]
      .filter(([k]) => k !== currentMonthKey)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, d]) => ({ month, ...d })),
  }

  return (
    <div className="min-h-screen pb-32 screen-enter">
      <div className="px-[18px] pt-[60px] pb-4 flex items-center gap-3">
        <Link
          href="/provider"
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <ChevronLeft size={18} style={{ color: 'var(--ink)' }} />
        </Link>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>
          Earnings
        </h1>
      </div>
      <div className="px-[18px]">
        <EarningsDashboard data={data} />
      </div>
    </div>
  )
}
