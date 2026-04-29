export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { type PaymentIntentStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Credit Top-ups', noIndex: true })

const PAYMENT_ADMIN_FLAG = 'admin.crud.payments'

const STATUS_OPTIONS: (PaymentIntentStatus | 'ALL')[] = [
  'ALL',
  'PENDING_PAYMENT',
  'PROOF_UPLOADED',
  'MATCHED_ON_STATEMENT',
  'CREDITED',
  'FAILED',
  'EXPIRED',
  'REVERSED',
]

const STATUS_STYLES: Record<PaymentIntentStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  CREATED: 'neutral',
  PENDING_PAYMENT: 'warning',
  PROOF_UPLOADED: 'info',
  MATCHED_ON_STATEMENT: 'info',
  CREDITED: 'success',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  REVERSED: 'danger',
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amountCents / 100)
}

function cleanStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

function buildHref(params: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  return qs ? `/admin/provider-credit-payments?${qs}` : '/admin/provider-credit-payments'
}

export default async function ProviderCreditPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; amount?: string }>
}) {
  const admin = await requireAdmin()
  const paymentActionsEnabled = await isEnabled(PAYMENT_ADMIN_FLAG, { userId: admin.id })
  const { q = '', status = 'PENDING_PAYMENT', amount = '' } = await searchParams
  const statusFilter = STATUS_OPTIONS.includes(status as PaymentIntentStatus)
    && status !== 'ALL'
    ? status as PaymentIntentStatus
    : undefined
  const amountCents = amount ? Math.round(Number(amount) * 100) : undefined
  const search = q.trim()

  const intents = await db.paymentIntent.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(amountCents && Number.isFinite(amountCents) ? { amountCents } : {}),
      ...(search
        ? {
            OR: [
              { paymentReference: { contains: search, mode: 'insensitive' } },
              { providerCellphone: { contains: search, mode: 'insensitive' } },
              { bankStatementReference: { contains: search, mode: 'insensitive' } },
              { provider: { name: { contains: search, mode: 'insensitive' } } },
              { provider: { phone: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Credit top-ups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reconcile manual EFT deposits before issuing Plug-A-Pro Credits.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/payments">Booking payments</Link>
        </Button>
      </div>

      {!paymentActionsEnabled ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Manual EFT reconciliation actions are disabled by feature flag
          <span className="font-mono"> {PAYMENT_ADMIN_FLAG}</span>.
        </div>
      ) : null}

      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_180px_140px_auto]">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search reference, phone, provider"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? 'ALL'}
          className="h-9 rounded-xl border bg-background px-3 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'ALL' ? 'All statuses' : cleanStatus(option)}
            </option>
          ))}
        </select>
        <Input
          name="amount"
          defaultValue={amount}
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount"
        />
        <Button type="submit">Search</Button>
      </form>

      <div className="flex flex-wrap gap-1">
        {STATUS_OPTIONS.map((option) => {
          const active = option === 'ALL' ? !statusFilter : statusFilter === option
          return (
            <Link
              key={option}
              href={buildHref({ q, amount, status: option === 'ALL' ? undefined : option })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border/80 bg-card/70 text-muted-foreground hover:bg-accent'
              }`}
            >
              {option === 'ALL' ? 'All' : cleanStatus(option)}
            </Link>
          )
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Payment reference</th>
              <th className="px-4 py-3 text-left font-medium">Provider</th>
              <th className="px-4 py-3 text-left font-medium">Cellphone</th>
              <th className="px-4 py-3 text-left font-medium">Amount</th>
              <th className="px-4 py-3 text-left font-medium">Credits</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {intents.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No provider top-up intents found.
                </td>
              </tr>
            ) : null}
            {intents.map((intent) => (
              <tr key={intent.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs">{intent.paymentReference}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{intent.provider.name}</p>
                  <p className="text-xs text-muted-foreground">{intent.provider.email ?? 'No email'}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {intent.providerCellphone ?? intent.provider.phone}
                </td>
                <td className="px-4 py-3 font-medium">{formatCurrency(intent.amountCents)}</td>
                <td className="px-4 py-3">{intent.creditsToIssue}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_STYLES[intent.status]}>{cleanStatus(intent.status)}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {intent.createdAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/provider-credit-payments/${intent.id}`}>
                      Review
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
