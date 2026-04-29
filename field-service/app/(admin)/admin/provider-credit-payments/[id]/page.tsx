export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { type PaymentIntentStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getProviderWalletLedgerEntries } from '@/lib/provider-wallet'
import {
  addTopUpIntentNoteFormAction,
  creditTopUpIntentFormAction,
  failTopUpIntentFormAction,
  reconcileTopUpIntentFormAction,
} from '../actions'

export const metadata = buildMetadata({ title: 'Credit Top-up Review', noIndex: true })

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

function cleanStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amountCents / 100)
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

function messageText(message?: string) {
  switch (message) {
    case 'matched':
      return 'Payment intent marked as matched on the bank statement.'
    case 'credited':
      return 'Provider wallet credited.'
    case 'failed':
      return 'Payment intent marked failed.'
    case 'note_added':
      return 'Admin note added.'
    case 'reconcile_failed':
      return 'Could not match this payment. Check the status, amount, and bank reference.'
    case 'credit_failed':
      return 'Could not credit this payment intent. It may already be credited or in an invalid status.'
    case 'fail_failed':
      return 'Could not mark this payment intent failed.'
    case 'note_failed':
      return 'Could not add admin note.'
    default:
      return null
  }
}

export default async function ProviderCreditPaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ message?: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const { message } = searchParams ? await searchParams : {}
  const banner = messageText(message)

  const intent = await db.paymentIntent.findUnique({
    where: { id },
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          wallet: true,
        },
      },
    },
  })

  if (!intent) notFound()

  const ledgerEntries = await getProviderWalletLedgerEntries(intent.providerId, {
    referenceType: 'payment_intent',
    referenceId: intent.id,
    limit: 10,
  })

  const canMatch = ['CREATED', 'PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT'].includes(intent.status)
  const canCredit = ['PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT'].includes(intent.status)
  const canFail = intent.status !== 'CREDITED'
  const proofDownloadHref = intent.proofOfPaymentUrl
    ? `/api/admin/provider-credit-payments/${intent.id}/proof`
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            href="/admin/provider-credit-payments"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Credit top-ups
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{intent.paymentReference}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm the bank deposit before issuing Plug-A-Pro Credits.
          </p>
        </div>
        <Badge variant={STATUS_STYLES[intent.status]}>{cleanStatus(intent.status)}</Badge>
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

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Payment intent</h2>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="font-medium">{intent.provider.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Provider cellphone</dt>
                <dd className="font-mono">{intent.providerCellphone ?? intent.provider.phone}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium">{formatCurrency(intent.amountCents)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Credits to issue</dt>
                <dd className="font-medium">{intent.creditsToIssue} paid credits</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Payment reference</dt>
                <dd className="font-mono">{intent.paymentReference}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bank statement reference</dt>
                <dd className="font-mono">{intent.bankStatementReference ?? 'Not matched'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Proof of payment</dt>
                <dd>
                  {proofDownloadHref ? (
                    <a
                      href={proofDownloadHref}
                      className="text-primary underline-offset-4 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open proof
                    </a>
                  ) : (
                    'Not uploaded'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Current wallet balance</dt>
                <dd className="font-medium">
                  {(intent.provider.wallet?.paidCreditBalance ?? 0) +
                    (intent.provider.wallet?.promoCreditBalance ?? 0)} credits
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Status timeline</h2>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex justify-between gap-4">
                <span>Created</span>
                <span className="text-muted-foreground">{formatDate(intent.createdAt)}</span>
              </li>
              <li className="flex justify-between gap-4">
                <span>Matched on statement</span>
                <span className="text-muted-foreground">{formatDate(intent.paidAt)}</span>
              </li>
              <li className="flex justify-between gap-4">
                <span>Credited</span>
                <span className="text-muted-foreground">{formatDate(intent.creditedAt)}</span>
              </li>
              <li className="flex justify-between gap-4">
                <span>Expires</span>
                <span className="text-muted-foreground">{formatDate(intent.expiresAt)}</span>
              </li>
            </ol>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Admin note</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {intent.adminNote || 'No admin notes yet.'}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Wallet ledger references</h2>
            {ledgerEntries.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No wallet credit has been issued for this intent.</p>
            ) : (
              <ul className="mt-3 divide-y text-sm">
                {ledgerEntries.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-4 py-3">
                    <span>
                      {entry.entryType} · {entry.creditType}
                    </span>
                    <span className="font-medium">+{entry.amountCredits} credits</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <form action={reconcileTopUpIntentFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="paymentIntentId" value={intent.id} />
            <h2 className="font-semibold">Mark as matched</h2>
            <p className="text-sm text-muted-foreground">
              Use this after the exact payment reference appears on the bank statement.
            </p>
            <Input
              name="bankStatementReference"
              defaultValue={intent.bankStatementReference ?? intent.paymentReference}
              placeholder="Bank statement reference"
              disabled={!canMatch}
              required
            />
            <Input
              name="statementAmountRand"
              type="number"
              min="0"
              step="0.01"
              defaultValue={(intent.amountCents / 100).toFixed(2)}
              disabled={!canMatch}
              required
            />
            <textarea
              name="adminNote"
              className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Admin note"
              disabled={!canMatch}
            />
            <Button type="submit" disabled={!canMatch} className="w-full">
              Mark matched
            </Button>
          </form>

          <form action={creditTopUpIntentFormAction} className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <input type="hidden" name="paymentIntentId" value={intent.id} />
            <h2 className="font-semibold text-emerald-950">Credit wallet</h2>
            <p className="text-sm text-emerald-900">
              Confirm this will add {intent.creditsToIssue} paid Plug-A-Pro Credits to {intent.provider.name}.
              This action cannot be repeated.
            </p>
            <textarea
              name="adminNote"
              className="min-h-20 w-full rounded-xl border bg-white px-3 py-2 text-sm"
              placeholder="Credit note"
              disabled={!canCredit}
              required
            />
            <Button type="submit" disabled={!canCredit} className="w-full">
              Confirm and credit wallet
            </Button>
          </form>

          <form action={failTopUpIntentFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="paymentIntentId" value={intent.id} />
            <h2 className="font-semibold">Mark failed</h2>
            <p className="text-sm text-muted-foreground">
              Use this when funds are not received, the amount is wrong, or the reference cannot be matched.
            </p>
            <textarea
              name="adminNote"
              className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Failure reason"
              disabled={!canFail}
              required
            />
            <Button type="submit" variant="outline" disabled={!canFail} className="w-full">
              Mark failed
            </Button>
          </form>

          <form action={addTopUpIntentNoteFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="paymentIntentId" value={intent.id} />
            <h2 className="font-semibold">Add admin note</h2>
            <textarea
              name="adminNote"
              className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Note"
              required
            />
            <Button type="submit" variant="outline" className="w-full">
              Add note
            </Button>
          </form>
        </aside>
      </div>
    </div>
  )
}
