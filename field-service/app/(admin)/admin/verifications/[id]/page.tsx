export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Role } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import {
  approveIdentityVerificationFormAction,
  refreshDiditSessionFormAction,
  rejectIdentityVerificationFormAction,
  requestIdentityVerificationRetryFormAction,
  retryIdentityVerificationWithVendorFormAction,
} from '../actions'

const NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'NOT_STARTED',
  'STARTED',
  'CONSENTED',
  'AWAITING_IDENTIFIER',
  'AWAITING_DOCUMENT',
  'AWAITING_SELFIE',
  'SUBMITTED',
  'PROCESSING',
  'AWAITING_LIVENESS',
  'NEEDS_MANUAL_REVIEW',
  'RETRY_REQUIRED',
])

export const metadata = buildMetadata({ title: 'Identity Verification Review', noIndex: true })

export default async function AdminIdentityVerificationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ message?: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params
  const { message } = searchParams ? await searchParams : {}
  const verification = await db.providerIdentityVerification.findUnique({
    where: { id },
    include: {
      provider: { select: { id: true, name: true, phone: true, email: true, kycStatus: true, status: true } },
      providerApplication: { select: { id: true, name: true, phone: true, status: true } },
      documents: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      webhookEvents: { orderBy: { receivedAt: 'asc' } },
      reviews: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!verification) notFound()

  const canPreviewDocuments = roleAtLeast(admin.adminRole, 'TRUST')
  const approveAssurance = verification.channel === 'WHATSAPP' ? 'LOW' : 'HIGH'
  const webhookEvents = verification.webhookEvents ?? []
  const reviewMessage = reviewActionMessage(message)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href="/admin/verifications" className="text-xs text-muted-foreground hover:text-foreground">
            Identity verifications
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{verification.provider?.name ?? verification.providerApplication?.name ?? 'Provider verification'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review identity evidence, status changes and manual review history.
          </p>
        </div>
        <Badge variant={verification.status === 'PASSED' ? 'success' : verification.status === 'FAILED' ? 'danger' : 'warning'}>
          {label(verification.status)}
        </Badge>
      </div>

      {reviewMessage ? (
        <div className={`${reviewMessage.tone} rounded-xl border px-4 py-3 text-sm`}>
          {reviewMessage.text}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Verification case</h2>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <Field label="Identity basis" value={verification.identityBasis} mono />
              <Field label="Channel" value={verification.channel} />
              <Field label="Assurance" value={verification.assuranceLevel} />
              <Field label="Decision" value={verification.decision ?? 'Not decided'} />
              <Field label="Vendor" value={verification.sourceCheckProvider ?? 'None'} mono />
              <Field label="Vendor ref" value={verification.vendorReference ?? 'None'} mono />
              <Field label="Vendor workflow" value={verification.vendorWorkflowId ?? 'None'} mono />
              <Field
                label="Cost estimate"
                value={
                  verification.costEstimateCents != null
                    ? `${verification.costCurrency ?? 'USD'} ${(verification.costEstimateCents / 100).toFixed(2)}`
                    : 'Unknown'
                }
              />
              <Field
                label="Decision recorded"
                value={verification.decisionAt ? formatDate(verification.decisionAt) : 'Not decided'}
              />
              <Field label="Liveness ref" value={verification.livenessSessionReference ?? 'None'} mono />
              <Field label="Identifier" value={verification.identifierLast4 ? `****${verification.identifierLast4}` : 'Not captured'} mono />
              <Field label="Issuing country" value={verification.issuingCountry ?? 'Not captured'} />
              <Field label="Nationality" value={verification.nationality ?? 'Not captured'} />
              <Field label="Document expiry" value={verification.documentExpiryDate ? formatDate(verification.documentExpiryDate) : 'Not captured'} />
              <Field label="Failure reason" value={verification.failureReasonCode ?? 'None'} />
              <Field label="Submitted" value={formatDate(verification.createdAt)} />
            </dl>
            <RiskFlags value={verification.riskFlags} />
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Documents</h2>
            <div className="mt-4 space-y-3">
              {verification.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : null}
              {verification.documents.map((document) => (
                <div key={document.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-mono text-xs">{document.documentKind}</p>
                    <p className="text-xs text-muted-foreground">
                      {document.mimeType} · {Math.ceil(document.sizeBytes / 1024)} KB · {document.status.toLowerCase()}
                    </p>
                  </div>
                  {canPreviewDocuments ? (
                    <a
                      href={`/api/admin/verifications/${verification.id}/document/${document.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Open private preview
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">TRUST access required</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Event timeline</h2>
            <div className="mt-4 space-y-3">
              {verification.events.map((event) => (
                <div key={event.id} className="rounded-md border p-3 text-sm">
                  <p>
                    <span className="font-mono text-xs">{event.fromStatus ?? 'START'}</span>
                    <span className="mx-2 text-muted-foreground">to</span>
                    <span className="font-mono text-xs">{event.toStatus}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(event.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Vendor webhook timeline</h2>
            <div className="mt-4 space-y-3">
              {webhookEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No provider webhooks received.</p>
              ) : null}
              {webhookEvents.map((event) => (
                <div key={event.id} className="rounded-md border p-3 text-sm">
                  <p className="font-mono text-xs">{event.eventType ?? 'unknown event'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.signatureValid ? 'signature valid' : 'invalid signature'} · {formatDate(event.receivedAt)}
                  </p>
                  {event.processingError ? <p className="mt-1 text-xs text-destructive">{event.processingError}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Provider</h2>
            <div className="mt-4 space-y-2 text-sm">
              <Field label="Name" value={verification.provider?.name ?? verification.providerApplication?.name ?? 'Unknown'} />
              <Field label="Phone" value={verification.provider?.phone ?? verification.providerApplication?.phone ?? 'Unknown'} mono />
              <Field label="Provider KYC" value={verification.provider?.kycStatus ?? 'No provider record'} />
            </div>
          </div>

          {verification.sourceCheckProvider === 'didit' && NON_TERMINAL_STATUSES.has(verification.status) && roleAtLeast(admin.adminRole, 'TRUST') ? (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Didit session</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Webhook missed? Pull the latest decision from Didit and re-apply it through the orchestrator.
              </p>
              <form action={refreshDiditSessionFormAction} className="mt-3">
                <input type="hidden" name="verificationId" value={verification.id} />
                <Button type="submit" size="sm" variant="outline">Refresh from Didit</Button>
              </form>
            </div>
          ) : null}

          {roleAtLeast(admin.adminRole, 'TRUST') ? (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="font-semibold">Manual review</h2>
              <ReviewForm
                verificationId={verification.id}
                assuranceLevel={approveAssurance}
                action={approveIdentityVerificationFormAction}
                buttonLabel="Approve"
              />
              <ReviewForm
                verificationId={verification.id}
                action={requestIdentityVerificationRetryFormAction}
                buttonLabel="Request retry"
                variant="secondary"
              />
              <ReviewForm
                verificationId={verification.id}
                action={retryIdentityVerificationWithVendorFormAction}
                buttonLabel="Retry with vendor"
                variant="secondary"
              />
              <ReviewForm
                verificationId={verification.id}
                action={rejectIdentityVerificationFormAction}
                buttonLabel="Reject"
                variant="danger"
              />
            </div>
          ) : (
            <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
              OPS can view status metadata. TRUST access is required for raw document preview and manual review decisions.
            </div>
          )}

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Review history</h2>
            <div className="mt-4 space-y-3">
              {verification.reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No manual review yet.</p>
              ) : null}
              {verification.reviews.map((review) => (
                <div key={review.id} className="rounded-md border p-3 text-sm">
                  <p className="font-mono text-xs">{review.decision}</p>
                  {review.notes ? <p className="mt-1">{review.notes}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(review.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ReviewForm({
  verificationId,
  assuranceLevel,
  action,
  buttonLabel,
  variant = 'primary',
}: {
  verificationId: string
  assuranceLevel?: string
  action: (formData: FormData) => Promise<void>
  buttonLabel: string
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const className = variant === 'danger'
    ? 'min-h-10 rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive'
    : variant === 'secondary'
      ? 'min-h-10 rounded-md border px-3 py-2 text-sm font-medium'
      : 'min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground'
  return (
    <form action={action} className="mt-3 grid gap-2">
      <input type="hidden" name="verificationId" value={verificationId} />
      {assuranceLevel ? <input type="hidden" name="assuranceLevel" value={assuranceLevel} /> : null}
      <textarea
        name="notes"
        rows={2}
        placeholder={`${buttonLabel} note`}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
      <button className={className}>{buttonLabel}</button>
    </form>
  )
}

function reviewActionMessage(message?: string) {
  switch (message) {
    case 'approved':
      return { tone: 'tone-success', text: 'Approval recorded and provider notification sent to WhatsApp.' }
    case 'approved-notification-failed':
      return {
        tone: 'tone-warning',
        text: 'Approval recorded, but the provider notification failed. Check Admin Messages for the failed WhatsApp event.',
      }
    case 'approved-notification-skipped':
      return {
        tone: 'tone-warning',
        text: 'Approval recorded, but no provider phone was available for the WhatsApp notification.',
      }
    case 'rejected':
      return { tone: 'tone-success', text: 'Rejection recorded.' }
    case 'retry':
      return { tone: 'tone-success', text: 'Retry request recorded.' }
    case 'vendor-retry':
      return { tone: 'tone-success', text: 'Vendor retry requested.' }
    default:
      return null
  }
}

function Field({ label: labelText, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{labelText}</dt>
      <dd className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</dd>
    </div>
  )
}

function RiskFlags({ value }: { value: unknown }) {
  const flags = riskFlagEntries(value)
  if (flags.length === 0) return null

  return (
    <div className="mt-4 rounded-md border bg-muted/30 p-3">
      <h3 className="text-sm font-semibold">Risk flags</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {flags.map(([key, flagValue]) => (
          <div key={key}>
            <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
            <dd className="font-medium">{formatRiskFlagValue(flagValue)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function riskFlagEntries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value)
}

function formatRiskFlagValue(value: unknown) {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value === null) return 'null'
  return JSON.stringify(value)
}

const ROLE_LEVEL: Record<Role, number> = {
  OPS: 1,
  FINANCE: 2,
  TRUST: 3,
  ADMIN: 4,
  OWNER: 5,
}

function roleAtLeast(role: Role, required: Role) {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required]
}

function label(value: string) {
  return value.replaceAll('_', ' ').toLowerCase()
}

function formatDate(value: Date) {
  return value.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
