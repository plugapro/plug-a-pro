export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { type PaymentIntentStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { getProviderWalletLedgerEntries } from '@/lib/provider-wallet'
import {
  summarizeWalletLedgerEntry,
  walletLedgerSignedAmount,
} from '@/lib/wallet-ledger-display'
import {
  addTopUpIntentNoteFormAction,
  creditTopUpIntentFormAction,
  failTopUpIntentFormAction,
  reconcileTopUpIntentFormAction,
} from '../actions'

export const metadata = buildMetadata({ title: 'Credit Top-up Review', noIndex: true })

const PAYMENT_ADMIN_FLAG = 'admin.crud.payments'

const STATUS_STYLES: Record<PaymentIntentStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
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
      return 'Could not match this payment. Check the status, amount and bank reference.'
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

function ledgerAmount(entry: { entryType: string; amountCredits: number }) {
  const signed = walletLedgerSignedAmount(entry)
  return `${signed > 0 ? '+' : ''}${signed}`
}

export default async function ProviderCreditPaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ message?: string }>
}) {
  const admin = await requireAdmin()
  const paymentActionsEnabled = await isEnabled(PAYMENT_ADMIN_FLAG, { userId: admin.id })
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

  const isPayfastIntent = ['PAYFAST_CARD', 'PAYFAST_EFT', 'PAYFAST_SCODE'].includes(intent.paymentMethod)
  // Matching (bank statement reconciliation) applies to manual EFT and Pay@.
  // EXPIRED is matchable so ops can recover a real payment that landed after the
  // checkout window closed or whose gateway ITN was lost (e.g. a Pay@ till
  // receipt) - match against the receipt reference, then credit.
  const canMatch = !isPayfastIntent && ['CREATED', 'PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT', 'EXPIRED'].includes(intent.status)
  // Payfast intents can be manually credited when stuck in PENDING_PAYMENT or
  // ITN_RECEIVED (ITN arrived but automatic crediting failed).
  const canCredit = isPayfastIntent
    ? ['PENDING_PAYMENT', 'ITN_RECEIVED'].includes(intent.status)
    : ['PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT'].includes(intent.status)
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
            Confirm the bank deposit before issuing Plug A Pro provider credits.
          </p>
        </div>
        <Badge variant={STATUS_STYLES[intent.status]}>{cleanStatus(intent.status)}</Badge>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          message?.endsWith('_failed')
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'tone-success'
        }`}>
          {banner}
        </div>
      ) : null}

      {!paymentActionsEnabled ? (
        <div className="tone-warning rounded-xl border px-4 py-3 text-sm">
          Manual EFT reconciliation actions are disabled by feature flag
          <span className="font-mono"> {PAYMENT_ADMIN_FLAG}</span>.
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
                <dt className="text-muted-foreground">Payment method</dt>
                <dd className="font-mono text-xs">{intent.paymentMethod}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Payment reference</dt>
                <dd className="font-mono">{intent.paymentReference}</dd>
              </div>
              {!isPayfastIntent ? (
                <>
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
                </>
              ) : null}
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
              {isPayfastIntent ? (
                <li className="flex justify-between gap-4">
                  <span>ITN received</span>
                  <span className="text-muted-foreground">{formatDate(intent.itnReceivedAt)}</span>
                </li>
              ) : (
                <li className="flex justify-between gap-4">
                  <span>Matched on statement</span>
                  <span className="text-muted-foreground">{formatDate(intent.paidAt)}</span>
                </li>
              )}
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

          {isPayfastIntent ? (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Payfast ITN data</h2>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">ITN payment status</dt>
                  <dd className="font-mono text-xs">{intent.itnPaymentStatus ?? 'Not received'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">ITN amount (gross)</dt>
                  <dd className="font-medium">
                    {intent.itnAmountCents != null ? formatCurrency(intent.itnAmountCents) : 'Not received'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">ITN received at</dt>
                  <dd className="text-muted-foreground">{formatDate(intent.itnReceivedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ledger entry ID</dt>
                  <dd className="font-mono text-xs">{intent.creditedLedgerEntryId ?? 'Not credited'}</dd>
                </div>
              </dl>
            </div>
          ) : null}

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
                {ledgerEntries.map((entry) => {
                  const summary = summarizeWalletLedgerEntry(entry)
                  return (
                    <li key={entry.id} className="space-y-1 py-3">
                      <div className="flex justify-between gap-4">
                        <span className="text-sm">{summary.title}</span>
                        <span className="font-medium">{ledgerAmount(entry)} credits</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {summary.referenceTypeLabel} · {summary.referenceHint}
                      </p>
                      {summary.details.length > 0 ? (
                        <p className="text-xs text-muted-foreground">{summary.details.join(' · ')}</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          {!isPayfastIntent ? (
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
              <FormSubmitButton disabled={!canMatch} fullWidth pendingLabel="Matching…">
                Mark matched
              </FormSubmitButton>
            </form>
          ) : null}

          <form action={creditTopUpIntentFormAction} className="space-y-3 rounded-xl border border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] p-4">
            <input type="hidden" name="paymentIntentId" value={intent.id} />
            <h2 className="font-semibold">Credit wallet</h2>
            <p className="text-sm">
              {isPayfastIntent
                ? `Manually credit ${intent.creditsToIssue} paid Plug A Pro provider credits to ${intent.provider.name}. Use only when the ITN was verified but automatic crediting failed.`
                : `Confirm this will add ${intent.creditsToIssue} paid Plug A Pro provider credits to ${intent.provider.name}. This action cannot be repeated.`}
            </p>
            <textarea
              name="adminNote"
              className="min-h-20 w-full rounded-xl border bg-card px-3 py-2 text-sm text-foreground"
              placeholder={isPayfastIntent ? 'Reason for manual credit' : 'Credit note'}
              disabled={!canCredit}
              required={isPayfastIntent}
            />
            <FormSubmitButton disabled={!canCredit} fullWidth pendingLabel="Crediting…">
              Confirm and credit wallet
            </FormSubmitButton>
          </form>

          <form action={failTopUpIntentFormAction} className="space-y-3 rounded-xl border bg-card p-4">
            <input type="hidden" name="paymentIntentId" value={intent.id} />
            <h2 className="font-semibold">Mark failed</h2>
            <p className="text-sm text-muted-foreground">
              Use this when funds are not received, the amount is wrong or the reference cannot be matched.
            </p>
            <textarea
              name="adminNote"
              className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              placeholder="Failure reason"
              disabled={!canFail}
              required
            />
            <FormSubmitButton variant="outline" disabled={!canFail} fullWidth pendingLabel="Marking failed…">
              Mark failed
            </FormSubmitButton>
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
            <FormSubmitButton variant="outline" fullWidth pendingLabel="Adding note…">
              Add note
            </FormSubmitButton>
          </form>
        </aside>
      </div>
    </div>
  )
}
