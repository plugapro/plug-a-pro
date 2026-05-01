export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  type LeadUnlockDisputeStatus,
  type LeadUnlockStatus,
  type PaymentIntentStatus,
  type ProviderWalletStatus,
} from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getProviderWalletLedgerEntries } from '@/lib/provider-wallet'
import {
  adjustProviderCreditsFormAction,
  reactivateProviderWalletFormAction,
  suspendProviderWalletFormAction,
} from '../actions'

export const metadata = buildMetadata({ title: 'Provider Wallet Management', noIndex: true })

const WALLET_STATUS_STYLES: Record<ProviderWalletStatus | 'NO_WALLET', 'warning' | 'success' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'danger',
  NO_WALLET: 'neutral',
}

const PAYMENT_STATUS_STYLES: Record<PaymentIntentStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  CREATED: 'neutral',
  PENDING_PAYMENT: 'warning',
  PROOF_UPLOADED: 'info',
  MATCHED_ON_STATEMENT: 'info',
  ITN_RECEIVED: 'info',
  CREDITED: 'success',
  CANCELLED: 'neutral',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  REVERSED: 'danger',
}

const UNLOCK_STATUS_STYLES: Record<LeadUnlockStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  UNLOCKED: 'success',
  DISPUTED: 'warning',
  REFUNDED: 'info',
  REVERSED: 'danger',
}

const DISPUTE_STATUS_STYLES: Record<LeadUnlockDisputeStatus, 'warning' | 'success' | 'danger'> = {
  OPEN: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
}

function cleanStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

function formatDate(value: Date | null) {
  if (!value) return 'Not set'
  return value.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amountCents / 100)
}

function ledgerAmount(entry: { entryType: string; amountCredits: number }) {
  const signed = entry.entryType === 'LEAD_UNLOCK_DEBIT' ||
    // Forward-compatible debit types; backing jobs are not implemented yet.
    entry.entryType === 'PROMO_EXPIRY' ||
    entry.entryType === 'PAYMENT_REVERSAL'
    ? -Math.abs(entry.amountCredits)
    : entry.amountCredits
  return `${signed > 0 ? '+' : ''}${signed}`
}

function ledgerCreditTypeLabel(entry: { entryType: string; creditType: string; amountCredits: number }) {
  if (entry.amountCredits === 0 && entry.entryType.startsWith('WALLET_')) {
    return 'Status event'
  }
  return entry.creditType
}

function messageText(message?: string) {
  switch (message) {
    case 'adjusted':
      return 'Admin adjustment applied and ledgered.'
    case 'suspended':
      return 'Provider wallet suspended. Lead unlocks are blocked while suspended.'
    case 'reactivated':
      return 'Provider wallet reactivated.'
    case 'adjust_failed':
      return 'Could not apply the adjustment. Check the amount, reason, and current balance.'
    case 'suspend_failed':
      return 'Could not suspend the wallet. A reason is required.'
    case 'reactivate_failed':
      return 'Could not reactivate the wallet. A reason is required.'
    default:
      return null
  }
}

export default async function ProviderWalletDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams?: Promise<{ message?: string }>
}) {
  await requireAdmin()
  const { providerId } = await params
  const { message } = searchParams ? await searchParams : {}
  const banner = messageText(message)

  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      kycStatus: true,
      wallet: true,
      paymentIntents: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      leadUnlocks: {
        orderBy: { unlockedAt: 'desc' },
        take: 10,
        include: {
          lead: {
            select: {
              id: true,
              status: true,
              jobRequest: {
                select: {
                  title: true,
                  category: true,
                },
              },
            },
          },
        },
      },
      leadUnlockDisputes: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          leadUnlock: {
            select: {
              id: true,
              leadId: true,
              creditsCharged: true,
            },
          },
        },
      },
    },
  })

  if (!provider) notFound()

  const ledgerEntries = await getProviderWalletLedgerEntries(provider.id, { limit: 50 })

  const walletStatus = provider.wallet?.status ?? 'NO_WALLET'
  const paidCredits = provider.wallet?.paidCreditBalance ?? 0
  const promoCredits = provider.wallet?.promoCreditBalance ?? 0
  const totalCredits = paidCredits + promoCredits

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            href="/admin/provider-wallets"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Provider wallets
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{provider.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {provider.phone} · {provider.email ?? 'No email'} · KYC {cleanStatus(provider.kycStatus)}
          </p>
        </div>
        <Badge variant={WALLET_STATUS_STYLES[walletStatus]}>
          {walletStatus === 'NO_WALLET' ? 'no wallet' : cleanStatus(walletStatus)}
        </Badge>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          message?.endsWith('_failed')
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-emerald-300 bg-emerald-50 text-emerald-900'
        }`}>
          {banner}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total credits</p>
          <p className="mt-2 text-3xl font-semibold">{totalCredits}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Purchased credits</p>
          <p className="mt-2 text-3xl font-semibold">{paidCredits}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Promo credits</p>
          <p className="mt-2 text-3xl font-semibold">{promoCredits}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Wallet status</p>
          <p className="mt-2 text-3xl font-semibold">{walletStatus === 'NO_WALLET' ? 'None' : cleanStatus(walletStatus)}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Wallet ledger</h2>
            {ledgerEntries.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No wallet ledger entries yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">When</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">Credits</th>
                      <th className="px-3 py-2 text-left font-medium">Balance after</th>
                      <th className="px-3 py-2 text-left font-medium">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2 text-muted-foreground">{formatDate(entry.createdAt)}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{cleanStatus(entry.entryType)}</p>
                          <p className="text-xs text-muted-foreground">{ledgerCreditTypeLabel(entry)}</p>
                        </td>
                        <td className="px-3 py-2 font-medium">{ledgerAmount(entry)}</td>
                        <td className="px-3 py-2">
                          {entry.balanceAfterPaidCredits + entry.balanceAfterPromoCredits}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({entry.balanceAfterPaidCredits} purchased, {entry.balanceAfterPromoCredits} promo)
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-mono text-xs">{entry.referenceType}</p>
                          <p className="font-mono text-xs text-muted-foreground">{entry.referenceId}</p>
                          {entry.description ? (
                            <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Payment intents</h2>
            {provider.paymentIntents.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No payment intents.</p>
            ) : (
              <ul className="mt-3 divide-y text-sm">
                {provider.paymentIntents.map((intent) => (
                  <li key={intent.id} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <Link
                        href={`/admin/provider-credit-payments/${intent.id}`}
                        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {intent.paymentReference}
                      </Link>
                      <p className="text-muted-foreground">
                        {formatCurrency(intent.amountCents)} · {intent.creditsToIssue} credits · {formatDate(intent.createdAt)}
                      </p>
                    </div>
                    <Badge variant={PAYMENT_STATUS_STYLES[intent.status]}>{cleanStatus(intent.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Lead unlocks</h2>
            {provider.leadUnlocks.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No lead unlocks.</p>
            ) : (
              <ul className="mt-3 divide-y text-sm">
                {provider.leadUnlocks.map((unlock) => (
                  <li key={unlock.id} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="font-medium">{unlock.lead.jobRequest.title}</p>
                      <p className="text-muted-foreground">
                        {unlock.lead.jobRequest.category} · {unlock.creditsCharged} credits · {formatDate(unlock.unlockedAt)}
                      </p>
                    </div>
                    <Badge variant={UNLOCK_STATUS_STYLES[unlock.status]}>{cleanStatus(unlock.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Disputes</h2>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/lead-unlock-disputes">Resolve disputes</Link>
              </Button>
            </div>
            {provider.leadUnlockDisputes.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No lead unlock disputes.</p>
            ) : (
              <ul className="mt-3 divide-y text-sm">
                {provider.leadUnlockDisputes.map((dispute) => (
                  <li key={dispute.id} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="font-medium">{cleanStatus(dispute.reason)}</p>
                      <p className="text-muted-foreground">
                        Lead {dispute.leadUnlock.leadId.slice(-8).toUpperCase()} · {formatDate(dispute.createdAt)}
                      </p>
                    </div>
                    <Badge variant={DISPUTE_STATUS_STYLES[dispute.status]}>{cleanStatus(dispute.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <form action={adjustProviderCreditsFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="providerId" value={provider.id} />
            <h2 className="font-semibold">Admin adjustment</h2>
            <p className="text-sm text-muted-foreground">
              Positive amounts add credits. Negative amounts remove credits and cannot take the wallet below zero.
            </p>
            <select
              name="creditType"
              className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
              defaultValue="PAID"
              required
            >
              <option value="PAID">Purchased credits</option>
              <option value="PROMO">Promo credits</option>
            </select>
            <Input
              name="amountCredits"
              type="number"
              step="1"
              placeholder="Amount, e.g. 5 or -2"
              required
            />
            <textarea
              name="reason"
              className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Required reason"
              required
            />
            <label className="flex items-start gap-2 text-sm">
              <input name="confirmAdjustment" type="checkbox" required className="mt-1" />
              <span>I confirm this manual credit adjustment is correct and auditable.</span>
            </label>
            <Button type="submit" className="w-full">
              Apply adjustment
            </Button>
          </form>

          <form action={suspendProviderWalletFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="providerId" value={provider.id} />
            <h2 className="font-semibold">Suspend wallet</h2>
            <p className="text-sm text-muted-foreground">
              Suspension blocks lead unlocks but keeps existing balances intact.
            </p>
            <textarea
              name="reason"
              className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Required suspension reason"
              disabled={walletStatus === 'SUSPENDED'}
              required
            />
            <Button type="submit" variant="outline" disabled={walletStatus === 'SUSPENDED'} className="w-full">
              Suspend wallet
            </Button>
          </form>

          <form action={reactivateProviderWalletFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="providerId" value={provider.id} />
            <h2 className="font-semibold">Reactivate wallet</h2>
            <p className="text-sm text-muted-foreground">
              Reactivated wallets can unlock leads again if KYC and credit balance checks pass.
            </p>
            <textarea
              name="reason"
              className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Required reactivation reason"
              disabled={walletStatus === 'ACTIVE'}
              required
            />
            <Button type="submit" disabled={walletStatus === 'ACTIVE'} className="w-full">
              Reactivate wallet
            </Button>
          </form>
        </aside>
      </div>
    </div>
  )
}
