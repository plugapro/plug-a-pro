// Provider: Earnings dashboard
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
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
  if (!provider) redirect('/technician')

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
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      <div className="flex items-center gap-3">
        <Link
          href="/technician"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Jobs
        </Link>
        <h1 className="text-xl font-semibold">Earnings</h1>
      </div>
      <EarningsDashboard data={data} />
    </div>
  )
}
