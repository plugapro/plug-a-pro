// ─── Admin: Payments ───────────────────────────────────────────────────────────
// Lists all payments with status filter tabs. Supports refund action for PAID payments.

export const dynamic = 'force-dynamic'

import type * as React from 'react'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import {
  buildPaymentFilterHref,
  dateRangeToCreatedAt,
  parsePaymentFilters,
  type PaymentDateRange,
} from '@/lib/admin/payment-filters'
import {
  OPS_QUEUE_TYPES,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
} from '@/lib/ops-queue'
import type { PaymentCollectionMode, PaymentStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'
import { getPaymentAdminMessage } from '@/lib/admin-action-messages'
import { CaseActivityTimeline } from '../_components/case-activity-timeline'
import { CaseNotes } from '../_components/case-notes'
import { ResolveCaseDialog } from '../_components/resolve-case-dialog'
import { claimPaymentAction, releasePaymentAction } from './actions'
import { ManagePaymentDialog } from './_components/ManagePaymentDialog'

export const metadata = buildMetadata({ title: 'Payments', noIndex: true })

const FLAG = 'admin.crud.payments'
const CASES_FLAG = 'ops.v2.cases'

// ─── Status badge styling ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<PaymentStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  PENDING:            'warning',
  AUTHORISED:         'info',
  PAID:               'success',
  FAILED:             'danger',
  REFUNDED:           'neutral',
  PARTIALLY_REFUNDED: 'neutral',
}

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING:            'Pending',
  AUTHORISED:         'Authorised',
  PAID:               'Paid',
  FAILED:             'Failed',
  REFUNDED:           'Refunded',
  PARTIALLY_REFUNDED: 'Part. Refunded',
}

const STATUS_FILTER_OPTIONS: { value: PaymentStatus | 'ALL'; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'AUTHORISED', label: 'Authorised' },
  { value: 'PAID', label: 'Paid' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'ALL', label: 'All' },
]

const DATE_FILTER_OPTIONS: { value: PaymentDateRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'ALL', label: 'All time' },
]

const COLLECTION_LABEL: Record<PaymentCollectionMode, string> = {
  OFFLINE_RECORDED: 'Offline / recorded only',
  PLATFORM_CHECKOUT: 'Platform checkout',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string; psp?: string; message?: string }>
}) {
  const admin = await requireAdmin()
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const casesEnabled = await isEnabled(CASES_FLAG, { userId: admin.id })
  const rawParams = await searchParams
  const { message } = rawParams
  const banner = getPaymentAdminMessage(message)

  const filters = parsePaymentFilters(rawParams)
  const createdAtGte = dateRangeToCreatedAt(filters.dateRange)
  const pspOptions = await db.payment.findMany({
    where: { pspProvider: { not: null } },
    select: { pspProvider: true },
    distinct: ['pspProvider'],
    orderBy: { pspProvider: 'asc' },
  })

  const payments = await db.payment.findMany({
    where: {
      ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
      ...(createdAtGte ? { createdAt: { gte: createdAtGte } } : {}),
      ...(filters.psp !== 'ALL' ? { pspProvider: filters.psp } : {}),
    },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                select: {
                  title: true,
                  customer: { select: { name: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
    payments.map((payment) => payment.id),
  )

  const activeCases = casesEnabled
    ? await db.case.findMany({
        where: {
          entityType: 'PAYMENT',
          entityId: { in: payments.map((p) => p.id) },
          state: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
          notes: { orderBy: { createdAt: 'desc' } },
        },
      }).catch(() => [])
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Payments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {payments.length} payments. Offline-recorded rows are booking trace records only until the money is actually collected and marked paid.
        </p>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${banner.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'tone-success'}`}>
          {banner.text}
        </div>
      ) : null}

      {!crudEnabled && (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          Payment mutations are disabled. Enable the <code>{FLAG}</code> feature flag to claim follow-ups or issue refunds.
        </div>
      )}

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <FilterGroup label="Status">
          {STATUS_FILTER_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              active={filters.status === option.value}
              href={buildPaymentFilterHref(rawParams, { status: option.value })}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterGroup>
        <FilterGroup label="Date range">
          {DATE_FILTER_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              active={filters.dateRange === option.value}
              href={buildPaymentFilterHref(rawParams, { dateRange: option.value })}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterGroup>
        <FilterGroup label="PSP">
          <FilterChip
            active={filters.psp === 'ALL'}
            href={buildPaymentFilterHref(rawParams, { psp: 'ALL' })}
          >
            All
          </FilterChip>
          {pspOptions.map((option) => {
            if (!option.pspProvider) return null
            return (
              <FilterChip
                key={option.pspProvider}
                active={filters.psp === option.pspProvider}
                href={buildPaymentFilterHref(rawParams, { psp: option.pspProvider })}
              >
                {option.pspProvider}
              </FilterChip>
            )
          })}
        </FilterGroup>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Ref</th>
              <th className="text-left px-4 py-3 font-medium">Customer</th>
              <th className="text-left px-4 py-3 font-medium">Job Request</th>
              <th className="text-left px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Collection</th>
              <th className="text-left px-4 py-3 font-medium">PSP Ref</th>
              <th className="text-left px-4 py-3 font-medium">Paid At</th>
              <th className="text-left px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  No payments found
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const customer = p.booking.match?.jobRequest.customer
              const jobTitle = p.booking.match?.jobRequest.title ?? '—'
              const assignment = assignments.get(p.id)
              const claimedByCurrentUser = assignment?.claimedById === admin.id
              const payAtMeta =
                typeof p.metadata === 'object' && p.metadata && !Array.isArray(p.metadata)
                  ? p.metadata as Record<string, unknown>
                  : null
              const payAtReference =
                typeof payAtMeta?.providerSourceReference === 'string'
                  ? payAtMeta.providerSourceReference
                  : null
              const payAtLastChecked =
                typeof payAtMeta?.providerLastCheckedAt === 'string'
                  ? payAtMeta.providerLastCheckedAt
                  : null
              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{p.id.slice(-8).toUpperCase()}</td>
                  <td className="px-4 py-3">
                    <p>{customer?.name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{customer?.phone ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{jobTitle}</td>
                  <td className="px-4 py-3 font-medium">
                    R {Number(p.amount).toFixed(2)}
                    {p.refundedAmount && (
                      <p className="text-xs text-muted-foreground">
                        Refunded: R {Number(p.refundedAmount).toFixed(2)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_STYLES[p.status]}>
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {COLLECTION_LABEL[p.collectionMode]}
                    {p.pspProvider && (
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.pspProvider}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {p.pspReference ? p.pspReference.slice(-12) : '—'}
                    {payAtReference ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">Pay@ ref: {payAtReference}</p>
                    ) : null}
                    {p.pspCheckoutId ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">Account: {p.pspCheckoutId}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.paidAt
                      ? p.paidAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}
                    {payAtLastChecked ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Last check: {new Date(payAtLastChecked).toLocaleString('en-ZA')}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                      {formatOpsQueueOwnerLabel(assignment, admin.id)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {!claimedByCurrentUser ? (
                        <form action={claimPaymentAction}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <SubmitButton type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
                            {assignment?.claimedById ? 'Take over' : 'Claim'}
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={releasePaymentAction}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <SubmitButton type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
                            Release
                          </SubmitButton>
                        </form>
                      )}
                      <ManagePaymentDialog
                        paymentId={p.id}
                        amount={Number(p.amount)}
                        status={p.status}
                        pspProvider={p.pspProvider}
                        adminRole={admin.adminRole}
                        disabled={!crudEnabled}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {casesEnabled && activeCases.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Open payment cases</h2>
          {activeCases.map((activeCase) => (
            <div key={activeCase.id} className="rounded-xl border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-muted-foreground">{activeCase.entityId.slice(-8).toUpperCase()}</p>
                <ResolveCaseDialog caseId={activeCase.id} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Timeline</p>
                <CaseActivityTimeline events={activeCase.events} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Notes</p>
                <CaseNotes caseId={activeCase.id} notes={activeCase.notes} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <p className="w-24 shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({
  active,
  href,
  children,
}: {
  active: boolean
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.18)]'
          : 'border border-border/80 bg-card/70 text-muted-foreground hover:bg-accent'
      }`}
    >
      {children}
    </a>
  )
}
