export const dynamic = 'force-dynamic'

import type {
  Prisma,
  SecurityEventStatus,
  SecurityEventType,
  SecuritySeverity,
} from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { maskPhone } from '@/lib/support-diagnostics'
import {
  acknowledgeSecurityEventFormAction,
  clearAccountLockFormAction,
  markFalsePositiveFormAction,
  resolveSecurityEventFormAction,
} from './actions'

export const metadata = buildMetadata({ title: 'OTP Security', noIndex: true })

type SearchParams = Record<string, string | string[] | undefined>

const STATUS_OPTIONS = ['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'] as const satisfies readonly SecurityEventStatus[]
const SEVERITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const satisfies readonly SecuritySeverity[]
const EVENT_TYPE_OPTIONS = [
  'OTP_REPORTED_UNREQUESTED',
  'OTP_RATE_LIMIT_EXCEEDED',
  'OTP_VERIFICATION_FAILED_REPEATEDLY',
  'OTP_DELIVERY_REFUSED_DURING_LOCK',
  'ACCOUNT_LOCKED',
  'STEP_UP_COMPLETED',
  'LOCK_CLEARED_BY_ADMIN',
  'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
  'WEBHOOK_SIGNATURE_INVALID_REPEATED',
  'IDENTITY_VERIFICATION_PILOT_BREACH',
] as const satisfies readonly SecurityEventType[]
const CATEGORY_OPTIONS = ['ALL', 'otp', 'identity_verification'] as const
const IDENTITY_SECURITY_EVENTS: SecurityEventType[] = [
  'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
  'WEBHOOK_SIGNATURE_INVALID_REPEATED',
  'IDENTITY_VERIFICATION_PILOT_BREACH',
]

const STATUS_LABELS: Record<SecurityEventStatus, string> = {
  NEW: 'New',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
  FALSE_POSITIVE: 'False positive',
}

const SEVERITY_LABELS: Record<SecuritySeverity, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
}

const EVENT_TYPE_LABELS: Record<SecurityEventType, string> = {
  OTP_REPORTED_UNREQUESTED: 'OTP reported unrequested',
  OTP_RATE_LIMIT_EXCEEDED: 'OTP rate limit exceeded',
  OTP_VERIFICATION_FAILED_REPEATEDLY: 'Repeated OTP verify failures',
  OTP_DELIVERY_REFUSED_DURING_LOCK: 'OTP delivery refused during lock',
  ACCOUNT_LOCKED: 'Account locked',
  STEP_UP_COMPLETED: 'Step-up completed',
  LOCK_CLEARED_BY_ADMIN: 'Lock cleared by admin',
  WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION: 'Identity webhook reference conflict',
  WEBHOOK_SIGNATURE_INVALID_REPEATED: 'Repeated invalid identity webhook signature',
  IDENTITY_VERIFICATION_PILOT_BREACH: 'Identity pilot allowlist breach',
}

function toText(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) return value[0]?.trim() || undefined
  return undefined
}

function pickOption<T extends string>(value: string | undefined, options: readonly T[]): T | undefined {
  return value && options.includes(value as T) ? (value as T) : undefined
}

function formatDate(date: Date | null): string {
  if (!date) return 'Not set'
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Johannesburg',
  }).format(date)
}

function metadataSummary(metadata: Prisma.JsonValue): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 'None'
  }

  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)

  return entries.length ? entries.join(', ') : 'None'
}

function badgeClass(kind: 'status' | 'severity', value: string): string {
  if (kind === 'severity') {
    if (value === 'CRITICAL' || value === 'HIGH') return 'border-red-200 bg-red-50 text-red-700'
    if (value === 'MEDIUM') return 'border-amber-200 bg-amber-50 text-amber-700'
    return 'border-slate-200 bg-slate-50 text-slate-700'
  }

  if (value === 'NEW') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (value === 'ACKNOWLEDGED') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (value === 'RESOLVED') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function categoryEventFilter(category: typeof CATEGORY_OPTIONS[number] | undefined): Prisma.EnumSecurityEventTypeFilter | SecurityEventType | undefined {
  if (category === 'identity_verification') return { in: IDENTITY_SECURITY_EVENTS }
  if (category === 'otp') return { notIn: IDENTITY_SECURITY_EVENTS }
  return undefined
}

function FilterSelect<T extends string>({
  label,
  name,
  value,
  options,
  labels,
}: {
  label: string
  name: string
  value?: T
  options: readonly T[]
  labels: Record<T, string>
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        name={name}
        defaultValue={value ?? ''}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  )
}

function EventActionForms({
  event,
}: {
  event: {
    id: string
    phoneE164: string | null
    status: SecurityEventStatus
  }
}) {
  const canAcknowledge = event.status === 'NEW'
  const canClose = event.status !== 'RESOLVED' && event.status !== 'FALSE_POSITIVE'

  return (
    <div className="grid min-w-64 gap-2">
      {canAcknowledge ? (
        <form action={acknowledgeSecurityEventFormAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="eventId" value={event.id} />
          <input
            name="reason"
            placeholder="Reason"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <button className="h-8 rounded-md border border-border px-3 text-xs font-medium" type="submit">
            Acknowledge
          </button>
        </form>
      ) : null}
      {canClose ? (
        <form action={resolveSecurityEventFormAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="eventId" value={event.id} />
          <input
            name="reason"
            placeholder="Resolution"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <button className="h-8 rounded-md border border-border px-3 text-xs font-medium" type="submit">
            Resolve
          </button>
        </form>
      ) : null}
      {canClose ? (
        <form action={markFalsePositiveFormAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="eventId" value={event.id} />
          <input
            name="reason"
            placeholder="Why false positive?"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <button className="h-8 rounded-md border border-border px-3 text-xs font-medium" type="submit">
            False positive
          </button>
        </form>
      ) : null}
      {event.phoneE164 ? (
        <form action={clearAccountLockFormAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="phoneE164" value={event.phoneE164} />
          <input
            name="reason"
            placeholder="Clear lock reason"
            required
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <button className="h-8 rounded-md border border-border px-3 text-xs font-medium" type="submit">
            Clear lock
          </button>
        </form>
      ) : null}
    </div>
  )
}

export default async function OtpSecurityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const actor = await requireAdmin()
  const resolved = await searchParams

  const status = pickOption(toText(resolved.status), STATUS_OPTIONS)
  const severity = pickOption(toText(resolved.severity), SEVERITY_OPTIONS)
  const eventType = pickOption(toText(resolved.eventType), EVENT_TYPE_OPTIONS)
  const category = pickOption(toText(resolved.category), CATEGORY_OPTIONS)

  const where: Prisma.SecurityEventWhereInput = {
    status,
    severity,
    eventType: eventType ?? categoryEventFilter(category),
  }

  const [events, canMutate] = await Promise.all([
    db.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        phoneE164: true,
        userId: true,
        eventType: true,
        severity: true,
        status: true,
        sourceChannel: true,
        metadata: true,
        relatedOtpChallengeId: true,
        subjectVerificationId: true,
        subjectWebhookEventId: true,
        createdAt: true,
        resolvedAt: true,
        resolvedByUserId: true,
      },
    }),
    isEnabled('admin.security.otp', { userId: actor.id }),
  ])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">OTP Security</h1>
          <p className="text-sm text-muted-foreground">
            Latest OTP abuse reports, lock events and step-up security events.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{events.length} of latest 100 events</p>
      </div>

      <form action="/admin/otp-security" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <FilterSelect label="Status" name="status" value={status} options={STATUS_OPTIONS} labels={STATUS_LABELS} />
        <FilterSelect label="Severity" name="severity" value={severity} options={SEVERITY_OPTIONS} labels={SEVERITY_LABELS} />
        <FilterSelect label="Event type" name="eventType" value={eventType} options={EVENT_TYPE_OPTIONS} labels={EVENT_TYPE_LABELS} />
        <FilterSelect label="Category" name="category" value={category ?? 'ALL'} options={CATEGORY_OPTIONS} labels={{ ALL: 'All', otp: 'OTP', identity_verification: 'Identity verification' }} />
        <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" type="submit">
          Apply
        </button>
        <a className="pb-2 text-sm text-muted-foreground underline-offset-4 hover:underline" href="/admin/otp-security">
          Clear
        </a>
      </form>

      {!canMutate ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The admin.security.otp feature flag is disabled. Events are read-only until the flag is enabled.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Metadata</th>
              {canMutate ? <th className="px-4 py-3">Actions</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((event) => (
              <tr key={event.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{EVENT_TYPE_LABELS[event.eventType]}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{event.id}</div>
                  {event.relatedOtpChallengeId ? (
                    <div className="mt-1 text-xs text-muted-foreground">Challenge {event.relatedOtpChallengeId}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{event.phoneE164 ? maskPhone(event.phoneE164) : 'No phone'}</div>
                  {event.subjectVerificationId ? (
                    <a className="text-xs underline underline-offset-4" href={`/admin/verifications/${event.subjectVerificationId}`}>
                      Open verification
                    </a>
                  ) : null}
                  {event.subjectWebhookEventId ? (
                    <div className="font-mono text-xs text-muted-foreground">Webhook {event.subjectWebhookEventId}</div>
                  ) : null}
                  {event.userId ? <div className="mt-1 text-xs text-muted-foreground">User linked</div> : null}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${badgeClass('severity', event.severity)}`}>
                    {SEVERITY_LABELS[event.severity]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${badgeClass('status', event.status)}`}>
                    {STATUS_LABELS[event.status]}
                  </span>
                  {event.resolvedAt ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDate(event.resolvedAt)}
                      {event.resolvedByUserId ? ` by ${event.resolvedByUserId}` : ''}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">{event.sourceChannel}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(event.createdAt)}</td>
                <td className="max-w-xs px-4 py-3 text-xs text-muted-foreground">{metadataSummary(event.metadata)}</td>
                {canMutate ? (
                  <td className="px-4 py-3">
                    <EventActionForms event={event} />
                  </td>
                ) : null}
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-muted-foreground" colSpan={canMutate ? 8 : 7}>
                  No OTP security events match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
