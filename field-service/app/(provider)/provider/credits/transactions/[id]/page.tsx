export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Receipt } from 'lucide-react'
import { AuthShell } from '@/components/shared/auth-shell'
import { buildMetadata } from '@/lib/metadata'
import { getProviderWalletLedgerEntry } from '../../actions'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return buildMetadata({ title: `Transaction ${id.slice(-8).toUpperCase()}`, noIndex: true })
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-3 last:border-b-0">
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.10em] text-[var(--ink-soft)]">
        {label}
      </span>
      <span className="max-w-[60%] text-right text-[13.5px] font-semibold text-[var(--ink)] break-words">
        {String(value)}
      </span>
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  const positive = delta > 0
  const neutral = delta === 0
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 font-mono text-[18px] font-extrabold ${
        positive
          ? 'bg-emerald-500/10 text-emerald-600'
          : 'bg-[var(--card-alt)] text-[var(--ink-mute)]'
      }`}
    >
      {neutral ? null : positive ? '+' : ''}
      {neutral ? 'No balance change' : `${delta} ${Math.abs(delta) === 1 ? 'credit' : 'credits'}`}
    </div>
  )
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tx = await getProviderWalletLedgerEntry(id)
  if (!tx) notFound()

  const balanceBeforeTotal =
    tx.balanceBeforePaidCredits !== null && tx.balanceBeforePromoCredits !== null
      ? tx.balanceBeforePaidCredits + tx.balanceBeforePromoCredits
      : null
  const balanceAfterTotal = tx.balanceAfterPaidCredits + tx.balanceAfterPromoCredits

  return (
    <AuthShell
      eyebrow="Credit activity"
      title={tx.title}
      subtitle={tx.description ?? undefined}
      backHref="/provider/credits"
      dense
    >
      <div className="mx-auto flex w-full max-w-[390px] flex-col gap-5 pb-4">
        <div className="flex flex-col items-center gap-3 rounded-[24px] bg-card p-6 text-center shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="flex size-14 items-center justify-center rounded-full bg-[var(--card-alt)]">
            <Receipt className="size-6 text-[var(--brand-purple)]" aria-hidden />
          </div>
          <DeltaBadge delta={tx.signedAmountCredits} />
          <div className="font-mono text-[10.5px] text-[var(--ink-soft)]">{tx.displayRef}</div>
        </div>

        <div className="rounded-[20px] bg-card px-4 shadow-[inset_0_0_0_1px_var(--border)]">
          <DetailRow label="Date" value={formatDateTime(tx.occurredAt)} />
          {tx.relatedJobCategory && (
            <DetailRow label="Category" value={tx.relatedJobCategory} />
          )}
          {tx.relatedJobTitle && (
            <DetailRow label="Job" value={tx.relatedJobTitle} />
          )}
          {tx.relatedJobRef && (
            <DetailRow label="Lead ref" value={`JOB-${tx.relatedJobRef}`} />
          )}
          {tx.relatedVoucherCampaign && (
            <DetailRow label="Voucher campaign" value={tx.relatedVoucherCampaign} />
          )}
          {tx.relatedVoucherBatchName && (
            <DetailRow label="Voucher batch" value={tx.relatedVoucherBatchName} />
          )}
          {tx.relatedPaymentRef && (
            <DetailRow label="Payment ref" value={tx.relatedPaymentRef} />
          )}
          <DetailRow label="Credit type" value={tx.creditType === 'PROMO' ? 'Starter/promo' : 'Purchased'} />
          {balanceBeforeTotal !== null && (
            <DetailRow label="Balance before" value={`${balanceBeforeTotal} credits`} />
          )}
          <DetailRow label="Balance after" value={`${balanceAfterTotal} credits`} />
          {tx.source && (
            <DetailRow label="Source" value={tx.source} />
          )}
          <DetailRow label="Reference" value={tx.displayRef} />
        </div>

        <Link
          href="/provider/credits"
          className="flex items-center justify-center gap-2 rounded-[14px] bg-card px-4 py-3 text-[13.5px] font-semibold text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to credits
        </Link>
      </div>
    </AuthShell>
  )
}
