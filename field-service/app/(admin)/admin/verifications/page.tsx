export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  type IdentityBasis,
  type VerificationAssuranceLevel,
  type VerificationChannel,
  type VerificationStatus,
} from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Identity Verifications', noIndex: true })

const FLAG = 'admin.crud.verifications'
const STATUS_OPTIONS = ['ALL', 'NEEDS_MANUAL_REVIEW', 'SUBMITTED', 'PROCESSING', 'AWAITING_LIVENESS', 'RETRY_REQUIRED', 'PASSED', 'FAILED'] as const
const CHANNEL_OPTIONS = ['ALL', 'PWA', 'WHATSAPP', 'ADMIN', 'VENDOR'] as const
const BASIS_OPTIONS = ['ALL', 'SA_ID', 'PASSPORT', 'REFUGEE_ID', 'ASYLUM_PERMIT', 'REFUGEE_PERMIT', 'WORK_PERMIT', 'PERMANENT_RESIDENCE_PERMIT'] as const
const ASSURANCE_OPTIONS = ['ALL', 'LOW', 'MEDIUM', 'HIGH'] as const

const STATUS_VARIANTS: Record<string, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  NEEDS_MANUAL_REVIEW: 'warning',
  SUBMITTED: 'info',
  PROCESSING: 'info',
  AWAITING_LIVENESS: 'warning',
  RETRY_REQUIRED: 'warning',
  PASSED: 'success',
  FAILED: 'danger',
}

export default async function AdminIdentityVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; basis?: string; assurance?: string }>
}) {
  const admin = await requireAdmin()
  const enabled = await isEnabled(FLAG, { userId: admin.id })
  const params = await searchParams
  const status = pick(params.status, STATUS_OPTIONS)
  const channel = pick(params.channel, CHANNEL_OPTIONS)
  const basis = pick(params.basis, BASIS_OPTIONS)
  const assurance = pick(params.assurance, ASSURANCE_OPTIONS)

  const verifications = await db.providerIdentityVerification.findMany({
    where: {
      ...(status && status !== 'ALL' ? { status: status as VerificationStatus } : {}),
      ...(channel && channel !== 'ALL' ? { channel: channel as VerificationChannel } : {}),
      ...(basis && basis !== 'ALL' ? { identityBasis: basis as IdentityBasis } : {}),
      ...(assurance && assurance !== 'ALL' ? { assuranceLevel: assurance as VerificationAssuranceLevel } : {}),
    },
    include: {
      provider: { select: { id: true, name: true, phone: true, kycStatus: true } },
      providerApplication: { select: { id: true, name: true, phone: true, status: true } },
      documents: { select: { id: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Identity verifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review provider ID, passport, permit, document, and selfie submissions.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/provider-credit-payments">Credit top-ups</Link>
        </Button>
      </div>

      {!enabled ? (
        <div className="tone-warning rounded-xl border px-4 py-3 text-sm">
          Review actions are disabled by feature flag <span className="font-mono">{FLAG}</span>.
        </div>
      ) : null}

      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-4">
        <FilterSelect name="status" value={status ?? 'NEEDS_MANUAL_REVIEW'} options={STATUS_OPTIONS} label="Status" />
        <FilterSelect name="channel" value={channel ?? 'ALL'} options={CHANNEL_OPTIONS} label="Channel" />
        <FilterSelect name="basis" value={basis ?? 'ALL'} options={BASIS_OPTIONS} label="Identity type" />
        <FilterSelect name="assurance" value={assurance ?? 'ALL'} options={ASSURANCE_OPTIONS} label="Assurance" />
        <div className="md:col-span-4">
          <Button type="submit" size="sm">Apply filters</Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Provider</th>
              <th className="px-4 py-3 text-left font-medium">Identity</th>
              <th className="px-4 py-3 text-left font-medium">Channel</th>
              <th className="px-4 py-3 text-left font-medium">Assurance</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Docs</th>
              <th className="px-4 py-3 text-left font-medium">Updated</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {verifications.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No identity verifications found.
                </td>
              </tr>
            ) : null}
            {verifications.map((verification) => {
              const providerName = verification.provider?.name ?? verification.providerApplication?.name ?? 'Unknown provider'
              const providerPhone = verification.provider?.phone ?? verification.providerApplication?.phone
              return (
                <tr key={verification.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{providerName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{providerPhone ?? 'No phone'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{verification.identityBasis}</p>
                    <p className="text-xs text-muted-foreground">
                      {verification.identifierLast4 ? `ending ****${verification.identifierLast4}` : 'not captured'}
                    </p>
                  </td>
                  <td className="px-4 py-3">{verification.channel}</td>
                  <td className="px-4 py-3">{verification.assuranceLevel}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANTS[verification.status] ?? 'neutral'}>{label(verification.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">{verification.documents.length}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(verification.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/verifications/${verification.id}`} className="text-primary underline-offset-4 hover:underline">
                      Review
                    </Link>
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

function FilterSelect({
  name,
  value,
  options,
  label: labelText,
}: {
  name: string
  value: string
  options: readonly string[]
  label: string
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{labelText}</span>
      <select name={name} defaultValue={value} className="h-9 rounded-xl border bg-background px-3 text-sm">
        {options.map((option) => (
          <option key={option} value={option}>{label(option)}</option>
        ))}
      </select>
    </label>
  )
}

function pick<T extends readonly string[]>(value: string | undefined, options: T): T[number] | undefined {
  return value && options.includes(value) ? value : undefined
}

function label(value: string) {
  return value === 'ALL' ? 'All' : value.replaceAll('_', ' ').toLowerCase()
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
