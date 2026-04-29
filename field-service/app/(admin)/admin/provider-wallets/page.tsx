export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { type ProviderWalletStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Provider Wallets', noIndex: true })

const STATUS_STYLES: Record<ProviderWalletStatus | 'NO_WALLET', 'warning' | 'success' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'danger',
  NO_WALLET: 'neutral',
}

function cleanStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

export default async function ProviderWalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  await requireAdmin()
  const { q = '', status = 'ALL' } = await searchParams
  const search = q.trim()
  const statusFilter = ['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(status)
    ? status as ProviderWalletStatus
    : undefined

  const providers = await db.provider.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(statusFilter ? { wallet: { status: statusFilter } } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      kycStatus: true,
      wallet: true,
      _count: {
        select: {
          paymentIntents: true,
          leadUnlocks: true,
          leadUnlockDisputes: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Provider wallets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review balances, ledger activity, unlocks, disputes, and controlled admin adjustments.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/provider-credit-payments">Credit top-ups</Link>
        </Button>
      </div>

      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_180px_auto]">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search provider name, phone, or email"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? 'ALL'}
          className="h-9 rounded-xl border bg-background px-3 text-sm"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CLOSED">Closed</option>
        </select>
        <Button type="submit">Search</Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Provider</th>
              <th className="px-4 py-3 text-left font-medium">Wallet</th>
              <th className="px-4 py-3 text-left font-medium">Paid</th>
              <th className="px-4 py-3 text-left font-medium">Promo</th>
              <th className="px-4 py-3 text-left font-medium">Activity</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {providers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No providers found.
                </td>
              </tr>
            ) : null}
            {providers.map((provider) => {
              const statusLabel = provider.wallet?.status ?? 'NO_WALLET'
              return (
                <tr key={provider.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {provider.phone} · {provider.email ?? 'No email'} · KYC {cleanStatus(provider.kycStatus)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_STYLES[statusLabel]}>
                      {statusLabel === 'NO_WALLET' ? 'no wallet' : cleanStatus(statusLabel)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {provider.wallet?.paidCreditBalance ?? 0}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {provider.wallet?.promoCreditBalance ?? 0}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {provider._count.paymentIntents} payments · {provider._count.leadUnlocks} unlocks · {provider._count.leadUnlockDisputes} disputes
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/provider-wallets/${provider.id}`}>Manage</Link>
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
