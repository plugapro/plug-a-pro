// ─── Admin /applications — v2 redesign view ──────────────────────────────────
// Server component. Receives data + server actions from page.tsx so all
// mutations continue to flow through the existing crudAction() audit pipeline.
// Renders behind feature flag admin.applications.redesign_v2.

import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Image as ImageIcon,
  Inbox,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  UserCircle2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SubmitButton } from '@/components/admin/ui'
import { CopyWaLink } from '@/components/admin/applications/CopyWaLink'
import {
  applyFilters,
  buildUnifiedRows,
  computeQueueCounts,
  filtersFromSearchParams,
  filtersToQueryString,
  stageLabel,
  BUCKET_LABEL,
  BUCKET_ORDER,
  type ApplicationInput,
  type AssignmentInput,
  type QueueBucket,
  type UnifiedApplicationRow,
  type WorklistFilters,
} from '@/lib/applications-queue'
import type { ProviderOnboardingRecoveryRow } from '@/lib/provider-onboarding-recovery'
import { resolveServiceCategoryTag } from '@/lib/service-categories'

// ─── Server actions contract ─────────────────────────────────────────────────

export type ApplicationsV2Actions = {
  approve: (formData: FormData) => Promise<void>
  reject: (formData: FormData) => Promise<void>
  requestMoreInfo: (formData: FormData) => Promise<void>
  claim: (formData: FormData) => Promise<void>
  release: (formData: FormData) => Promise<void>
  updateCategoryApproval: (formData: FormData) => Promise<void>
  sendRecoveryNudge: (formData: FormData) => Promise<void>
  sendAllDueRecoveries: () => Promise<void>
}

export type ApplicationsV2ViewProps = {
  applications: ApplicationInput[]
  recoveryRows: ProviderOnboardingRecoveryRow[]
  assignments: Map<string, AssignmentInput>
  conflictingApplicationIds: Set<string>
  adminId: string
  crudEnabled: boolean
  templateFlagEnabled: boolean
  bannerNode: React.ReactNode | null
  flag: string
  searchParams: Record<string, string | string[] | undefined>
  actions: ApplicationsV2Actions
}

// ─── Top-level view ──────────────────────────────────────────────────────────

export function ApplicationsV2View(props: ApplicationsV2ViewProps) {
  const now = new Date()
  const rows = buildUnifiedRows({
    applications: props.applications,
    recoveryRows: props.recoveryRows,
    assignments: props.assignments,
    conflictingApplicationIds: props.conflictingApplicationIds,
    currentAdminId: props.adminId,
    now,
  })

  const counts = computeQueueCounts(rows)
  const filters = filtersFromSearchParams(props.searchParams)
  const filteredRows = applyFilters(rows, filters)

  const selectedRowId =
    typeof props.searchParams.selected === 'string' ? props.searchParams.selected : null
  const selectedRow = selectedRowId
    ? rows.find((r) => r.rowId === selectedRowId) ?? null
    : null

  const grouped = groupByBucket(filteredRows)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Provider Applications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unified worklist across WhatsApp recovery and submitted applications. Sorted by
            operational priority — review P1 first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={props.actions.sendAllDueRecoveries}>
            <SubmitButton
              size="sm"
              variant="outline"
              disabled={!props.crudEnabled}
              pendingLabel="Sending due nudges…"
            >
              Send all due nudges
            </SubmitButton>
          </form>
        </div>
      </header>

      {props.bannerNode}

      {!props.crudEnabled ? (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          Application mutations are disabled. Enable the <code>{props.flag}</code> feature flag to
          claim, approve or reject provider applications.
        </div>
      ) : null}

      <QueueStrip counts={counts} active={filters.bucket ?? null} filters={filters} />

      <FiltersRow filters={filters} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)]">
        <div className="min-w-0">
          {filteredRows.length === 0 ? (
            <EmptyState filters={filters} totalRows={rows.length} />
          ) : (
            <div className="space-y-6">
              {grouped.map(([bucket, bucketRows]) => (
                <WorklistGroup
                  key={bucket}
                  bucket={bucket}
                  rows={bucketRows}
                  selectedRowId={selectedRowId}
                  filters={filters}
                />
              ))}
            </div>
          )}
          {rows.length >= 100 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Showing the latest 100 records. Refine filters to surface older items.
            </p>
          ) : null}
        </div>

        <ApplicationDrawer
          row={selectedRow}
          crudEnabled={props.crudEnabled}
          templateFlagEnabled={props.templateFlagEnabled}
          actions={props.actions}
          filters={filters}
        />
      </div>
    </div>
  )
}

// ─── Queue strip ─────────────────────────────────────────────────────────────

function QueueStrip({
  counts,
  active,
  filters,
}: {
  counts: ReturnType<typeof computeQueueCounts>
  active: QueueBucket | null
  filters: WorklistFilters
}) {
  return (
    <nav
      aria-label="Application queues"
      className="-mx-1 flex flex-wrap items-center gap-1.5 px-1"
      data-admin-applications-queue-strip
    >
      <QueueChip
        label="All"
        count={counts.total}
        href={hrefForFilters({ ...filters, bucket: null })}
        active={active === null}
      />
      {BUCKET_ORDER.map((bucket) => (
        <QueueChip
          key={bucket}
          label={BUCKET_LABEL[bucket]}
          count={counts[bucket]}
          href={hrefForFilters({ ...filters, bucket })}
          active={active === bucket}
          tone={chipToneForBucket(bucket)}
        />
      ))}
    </nav>
  )
}

function QueueChip({
  label,
  count,
  href,
  active,
  tone = 'neutral',
}: {
  label: string
  count: number
  href: string
  active: boolean
  tone?: 'neutral' | 'attention' | 'success' | 'muted'
}) {
  const toneClass = active
    ? 'border-foreground bg-foreground text-background shadow-sm'
    : tone === 'attention'
      ? 'border-amber-300/60 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-300/30 dark:bg-amber-950/40 dark:text-amber-100'
      : tone === 'success'
        ? 'border-emerald-300/60 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-300/30 dark:bg-emerald-950/40 dark:text-emerald-100'
        : tone === 'muted'
          ? 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50'
          : 'border-border bg-card text-foreground hover:bg-muted/50'

  return (
    <Link
      href={href}
      scroll={false}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${toneClass}`}
      aria-current={active ? 'page' : undefined}
    >
      <span>{label}</span>
      <span className="rounded-full bg-background/40 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
        {count}
      </span>
    </Link>
  )
}

function chipToneForBucket(bucket: QueueBucket): 'neutral' | 'attention' | 'success' | 'muted' {
  if (bucket === 'ready_to_review') return 'success'
  if (bucket === 'stuck_mid_flow' || bucket === 'conflict' || bucket === 'more_info') return 'attention'
  if (bucket === 'terminal' || bucket === 'approved') return 'muted'
  return 'neutral'
}

// ─── Filters row ─────────────────────────────────────────────────────────────

function FiltersRow({ filters }: { filters: WorklistFilters }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2 text-xs">
      <form
        action="/admin/applications"
        method="get"
        className="flex flex-1 items-center gap-2 min-w-[220px]"
      >
        {filters.bucket ? <input type="hidden" name="queue" value={filters.bucket} /> : null}
        {filters.source ? <input type="hidden" name="src" value={filters.source} /> : null}
        {filters.kyc ? <input type="hidden" name="kyc" value={filters.kyc} /> : null}
        {filters.hasIdNumber === true ? <input type="hidden" name="id" value="1" /> : null}
        {filters.hasIdNumber === false ? <input type="hidden" name="id" value="0" /> : null}
        {filters.hasProfilePhoto === true ? <input type="hidden" name="photo" value="1" /> : null}
        {filters.hasProfilePhoto === false ? <input type="hidden" name="photo" value="0" /> : null}
        {filters.claimedOnly ? <input type="hidden" name="claimed" value="1" /> : null}
        {filters.unclaimedOnly ? <input type="hidden" name="unclaimed" value="1" /> : null}
        <Input
          name="q"
          defaultValue={filters.query ?? ''}
          placeholder="Search name, phone, or last 8 of ID…"
          className="h-8 text-xs"
          aria-label="Search applications"
        />
        <SubmitButton size="sm" variant="outline">
          Search
        </SubmitButton>
        {filters.query ? (
          <Link
            href={hrefForFilters({ ...filters, query: null })}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <span className="hidden h-5 w-px bg-border md:inline-block" />

      <FilterChipGroup
        label="Source"
        options={[
          { value: null, label: 'Any' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'pwa', label: 'PWA' },
          { value: 'admin', label: 'Admin' },
          { value: 'unknown', label: 'Unknown' },
        ]}
        active={filters.source ?? null}
        filterKey="src"
        filters={filters}
      />

      <FilterChipGroup
        label="KYC"
        options={[
          { value: null, label: 'Any' },
          { value: 'NOT_STARTED', label: 'Not started' },
          { value: 'IN_PROGRESS', label: 'In progress' },
          { value: 'SUBMITTED', label: 'Submitted' },
          { value: 'VERIFIED', label: 'Verified' },
          { value: 'REJECTED', label: 'Rejected' },
          { value: 'EXPIRED', label: 'Expired' },
        ]}
        active={filters.kyc ?? null}
        filterKey="kyc"
        filters={filters}
      />

      <FilterChipGroup
        label="ID"
        options={[
          { value: null, label: 'Any' },
          { value: '1', label: 'Provided' },
          { value: '0', label: 'Missing' },
        ]}
        active={filters.hasIdNumber === true ? '1' : filters.hasIdNumber === false ? '0' : null}
        filterKey="id"
        filters={filters}
      />

      <FilterChipGroup
        label="Photo"
        options={[
          { value: null, label: 'Any' },
          { value: '1', label: 'Provided' },
          { value: '0', label: 'Missing' },
        ]}
        active={
          filters.hasProfilePhoto === true ? '1' : filters.hasProfilePhoto === false ? '0' : null
        }
        filterKey="photo"
        filters={filters}
      />

      <FilterChipGroup
        label="Claim"
        options={[
          { value: null, label: 'Any' },
          { value: 'claimed', label: 'Claimed' },
          { value: 'unclaimed', label: 'Unclaimed' },
        ]}
        active={filters.claimedOnly ? 'claimed' : filters.unclaimedOnly ? 'unclaimed' : null}
        filterKey="claim"
        filters={filters}
      />
    </div>
  )
}

function FilterChipGroup({
  label,
  options,
  active,
  filterKey,
  filters,
}: {
  label: string
  options: Array<{ value: string | null; label: string }>
  active: string | null
  filterKey: 'src' | 'id' | 'photo' | 'claim' | 'kyc'
  filters: WorklistFilters
}) {
  function hrefFor(value: string | null) {
    const next: WorklistFilters = { ...filters }
    if (filterKey === 'src') next.source = (value as WorklistFilters['source']) ?? null
    if (filterKey === 'id') {
      next.hasIdNumber = value === '1' ? true : value === '0' ? false : null
    }
    if (filterKey === 'photo') {
      next.hasProfilePhoto = value === '1' ? true : value === '0' ? false : null
    }
    if (filterKey === 'claim') {
      next.claimedOnly = value === 'claimed' ? true : null
      next.unclaimedOnly = value === 'unclaimed' ? true : null
    }
    if (filterKey === 'kyc') {
      next.kyc = (value as WorklistFilters['kyc']) ?? null
    }
    return hrefForFilters(next)
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {options.map((opt) => {
        const isActive = active === opt.value
        return (
          <Link
            key={opt.value ?? '_any'}
            href={hrefFor(opt.value)}
            scroll={false}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              isActive
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card hover:bg-muted/50'
            }`}
          >
            {opt.label}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Worklist group ──────────────────────────────────────────────────────────

function WorklistGroup({
  bucket,
  rows,
  selectedRowId,
  filters,
}: {
  bucket: QueueBucket
  rows: UnifiedApplicationRow[]
  selectedRowId: string | null
  filters: WorklistFilters
}) {
  return (
    <section data-admin-applications-bucket={bucket} className="space-y-2">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <PriorityBadge bucket={bucket} />
          {BUCKET_LABEL[bucket]}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground/80">
            {rows.length}
          </span>
        </h2>
      </header>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.rowId}>
            <WorklistRow row={row} selected={row.rowId === selectedRowId} filters={filters} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function PriorityBadge({ bucket }: { bucket: QueueBucket }) {
  const priority =
    bucket === 'ready_to_review'
      ? 1
      : bucket === 'stuck_mid_flow'
        ? 2
        : bucket === 'more_info' || bucket === 'conflict'
          ? 3
          : bucket === 'idle'
            ? 4
            : bucket === 'approved'
              ? 5
              : 6
  const tone =
    priority === 1
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
      : priority === 2
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
        : priority === 3
          ? 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100'
          : priority === 4
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100'
            : priority === 5
              ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/60 dark:text-slate-100'
              : 'bg-muted text-muted-foreground'
  return (
    <span
      className={`inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-md px-1.5 text-[10px] font-bold tracking-wide ${tone}`}
    >
      P{priority}
    </span>
  )
}

// ─── Worklist row ────────────────────────────────────────────────────────────

function WorklistRow({
  row,
  selected,
  filters,
}: {
  row: UnifiedApplicationRow
  selected: boolean
  filters: WorklistFilters
}) {
  const href = hrefForFilters({ ...filters }, { selected: row.rowId })
  const completeness = row.completeness
  const scoreTotal = 8
  const scoreSatisfied = completeness ? scoreTotal - completeness.missing.length : null

  return (
    <Link
      href={href}
      scroll={false}
      data-admin-applications-row={row.rowId}
      data-admin-applications-bucket={row.bucket}
      className={`group block rounded-lg border px-3 py-2.5 transition-colors ${
        selected
          ? 'border-foreground/60 bg-muted/40 ring-2 ring-foreground/10'
          : 'border-border bg-card hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <SourceIcon source={row.source} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">
              {row.name?.trim() || (
                <span className="italic text-muted-foreground">Unknown name</span>
              )}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {row.phoneMasked}
            </span>
            {row.application ? (
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                #{row.application.id.slice(-8)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{row.primarySkill ? capitalise(row.primarySkill) : 'No category'}</span>
            <span>·</span>
            <span>{row.primaryArea ?? 'No area'}</span>
            <span>·</span>
            <span>{formatRelative(row.lastActivityAt)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <BucketChip bucket={row.bucket} />
            {scoreSatisfied !== null ? (
              <ScoreChip satisfied={scoreSatisfied} total={scoreTotal} />
            ) : null}
            {row.flags.hasIdNumber ? (
              <SignalChip icon={<ShieldCheck className="h-3 w-3" />} label="ID" tone="success" />
            ) : (
              <SignalChip icon={<ShieldAlert className="h-3 w-3" />} label="ID missing" tone="warning" />
            )}
            {row.flags.hasProfilePhoto ? (
              <SignalChip icon={<ImageIcon className="h-3 w-3" />} label="Photo" tone="success" />
            ) : (
              <SignalChip icon={<ImageIcon className="h-3 w-3" />} label="No photo" tone="warning" />
            )}
            {row.flags.attachmentCount > 0 ? (
              <SignalChip
                icon={<FileText className="h-3 w-3" />}
                label={`${row.flags.attachmentCount} ${
                  row.flags.attachmentCount === 1 ? 'doc' : 'docs'
                }`}
                tone="neutral"
              />
            ) : null}
            {row.flags.kycStatus ? (
              <SignalChip
                icon={<UserCircle2 className="h-3 w-3" />}
                label={`KYC ${row.flags.kycStatus.toLowerCase().replace(/_/g, ' ')}`}
                tone={row.flags.kycStatus === 'VERIFIED' ? 'success' : 'neutral'}
              />
            ) : null}
            {row.recovery ? (
              <SignalChip
                icon={<MessageSquare className="h-3 w-3" />}
                label={stageLabel(row.recovery.stage)}
                tone={row.flags.outsideSessionWindow ? 'danger' : 'neutral'}
              />
            ) : null}
            {row.hasConflict ? (
              <SignalChip icon={<AlertTriangle className="h-3 w-3" />} label="Conflict" tone="danger" />
            ) : null}
            {row.assignment?.claimedById ? (
              <SignalChip
                icon={<ClipboardCheck className="h-3 w-3" />}
                label={row.flags.claimedByCurrentUser ? 'Claimed by you' : 'Claimed by ops'}
                tone={row.flags.claimedByCurrentUser ? 'brand' : 'neutral'}
              />
            ) : null}
          </div>
          <p className="text-[11px] italic text-muted-foreground/90">{row.recommendedAction}</p>
        </div>
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </Link>
  )
}

function SourceIcon({ source }: { source: UnifiedApplicationRow['source'] }) {
  const map = {
    whatsapp: { Icon: MessageSquare, label: 'WhatsApp' },
    pwa: { Icon: UserCircle2, label: 'PWA' },
    admin: { Icon: ShieldCheck, label: 'Admin-created' },
    unknown: { Icon: Inbox, label: 'Unknown source' },
  } as const
  const { Icon, label } = map[source]
  return (
    <span
      className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground"
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  )
}

function BucketChip({ bucket }: { bucket: QueueBucket }) {
  const variant: 'success' | 'warning' | 'outline' =
    bucket === 'ready_to_review' || bucket === 'approved'
      ? 'success'
      : bucket === 'conflict' || bucket === 'more_info' || bucket === 'stuck_mid_flow'
        ? 'warning'
        : 'outline'
  return (
    <Badge variant={variant} className="rounded-full text-[10px]">
      {BUCKET_LABEL[bucket]}
    </Badge>
  )
}

function ScoreChip({ satisfied, total }: { satisfied: number; total: number }) {
  const complete = satisfied === total
  const tone = complete
    ? 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-300/30 dark:bg-emerald-950/40 dark:text-emerald-100'
    : 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-300/30 dark:bg-amber-950/40 dark:text-amber-100'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${tone}`}
    >
      {complete ? <CheckCircle2 className="h-3 w-3" /> : null}
      {satisfied}/{total}
    </span>
  )
}

function SignalChip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-300/50 bg-emerald-50 text-emerald-900 dark:border-emerald-300/30 dark:bg-emerald-950/40 dark:text-emerald-100'
      : tone === 'warning'
        ? 'border-amber-300/50 bg-amber-50 text-amber-900 dark:border-amber-300/30 dark:bg-amber-950/40 dark:text-amber-100'
        : tone === 'danger'
          ? 'border-rose-300/60 bg-rose-50 text-rose-900 dark:border-rose-300/30 dark:bg-rose-950/40 dark:text-rose-100'
          : tone === 'brand'
            ? 'border-foreground/60 bg-foreground text-background'
            : 'border-border bg-card text-muted-foreground'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${toneClass}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  )
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

function ApplicationDrawer({
  row,
  crudEnabled,
  templateFlagEnabled,
  actions,
  filters,
}: {
  row: UnifiedApplicationRow | null
  crudEnabled: boolean
  templateFlagEnabled: boolean
  actions: ApplicationsV2Actions
  filters: WorklistFilters
}) {
  if (!row) {
    return (
      <aside className="hidden rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground lg:flex lg:items-center lg:justify-center">
        Select a row to review evidence and take action.
      </aside>
    )
  }

  const closeHref = hrefForFilters(filters)
  const app = row.application
  const completeness = row.completeness

  return (
    <aside
      data-admin-applications-drawer={row.rowId}
      className="rounded-xl border border-border bg-card shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {row.name?.trim() || <span className="italic text-muted-foreground">Unknown</span>}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{row.phoneMasked}</span>
            <CopyWaLink phone={row.phoneKey} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <BucketChip bucket={row.bucket} />
            <PriorityBadge bucket={row.bucket} />
            {app ? (
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                #{app.id.slice(-8)}
              </span>
            ) : null}
          </div>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted/50"
          aria-label="Close drawer"
        >
          <X className="h-4 w-4" />
        </Link>
      </header>

      <div className="space-y-4 px-4 py-4 text-sm">
        <DrawerStatusBlock row={row} />
        {completeness ? <DrawerCompleteness completeness={completeness} /> : null}
        {app ? <DrawerApplicationDetails app={app} /> : null}
        {app ? <DrawerEvidence app={app} /> : null}
        {row.recovery ? <DrawerRecovery row={row} /> : null}
        {app && app.status === 'APPROVED' ? (
          <DrawerCategoryApproval app={app} actions={actions} crudEnabled={crudEnabled} />
        ) : null}
        <DrawerActions
          row={row}
          actions={actions}
          crudEnabled={crudEnabled}
          templateFlagEnabled={templateFlagEnabled}
        />
      </div>
    </aside>
  )
}

function DrawerStatusBlock({ row }: { row: UnifiedApplicationRow }) {
  const app = row.application
  return (
    <section className="space-y-1.5 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
      <p className="font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Application</dt>
        <dd>{app ? app.status : '—'}</dd>
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{app?.provider ? (app.provider.verified ? 'Verified' : 'Linked, unverified') : '—'}</dd>
        <dt className="text-muted-foreground">KYC</dt>
        <dd>{row.flags.kycStatus ? row.flags.kycStatus.replace(/_/g, ' ') : '—'}</dd>
        <dt className="text-muted-foreground">Recovery stage</dt>
        <dd>{row.recovery ? stageLabel(row.recovery.stage) : '—'}</dd>
        <dt className="text-muted-foreground">Last activity</dt>
        <dd>{formatRelative(row.lastActivityAt)}</dd>
        <dt className="text-muted-foreground">Claim</dt>
        <dd>{ownerLabel(row.assignment)}</dd>
      </dl>
    </section>
  )
}

function DrawerCompleteness({
  completeness,
}: {
  completeness: NonNullable<UnifiedApplicationRow['completeness']>
}) {
  const total = Math.max(8, completeness.missing.length)
  const satisfied = total - completeness.missing.length
  const blockingApprove = completeness.missing.filter(
    (m) => m.severity === 'block_submit' || m.severity === 'block_approve',
  )
  const recommended = completeness.missing.filter((m) => m.severity === 'recommended')

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <p className="font-semibold uppercase tracking-wider text-muted-foreground">Completeness</p>
        <ScoreChip satisfied={satisfied} total={total} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${completeness.canApprove ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${Math.round((satisfied / total) * 100)}%` }}
        />
      </div>
      {blockingApprove.length > 0 ? (
        <div className="rounded-md border border-amber-300/40 bg-amber-50/40 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">Blocks approval</p>
          <ul className="mt-1 ml-4 list-disc">
            {blockingApprove.map((item) => (
              <li key={item.field}>
                <span className="font-mono">{item.field}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {recommended.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Recommended ({recommended.length}) <ChevronDown className="ml-1 inline h-3 w-3" />
          </summary>
          <ul className="mt-1 ml-4 list-disc">
            {recommended.map((item) => (
              <li key={item.field}>
                <span className="font-mono">{item.field}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

function DrawerApplicationDetails({ app }: { app: ApplicationInput }) {
  return (
    <section className="space-y-2 text-xs">
      <p className="font-semibold uppercase tracking-wider text-muted-foreground">Application</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Skills</dt>
        <dd>
          {app.skills.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {app.skills.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-border bg-muted/30 px-1.5 py-0.5 text-[10px]"
                >
                  {capitalise(s)}
                </span>
              ))}
            </div>
          )}
        </dd>
        <dt className="text-muted-foreground">Service areas</dt>
        <dd>
          {app.serviceAreas.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {app.serviceAreas.map((a) => (
                <span
                  key={a}
                  className="rounded-full border border-border bg-muted/30 px-1.5 py-0.5 text-[10px]"
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </dd>
        <dt className="text-muted-foreground">Experience</dt>
        <dd>{app.experience || '—'}</dd>
        <dt className="text-muted-foreground">Availability</dt>
        <dd>{app.availability || '—'}</dd>
        <dt className="text-muted-foreground">Call-out fee</dt>
        <dd>{app.callOutFee != null ? `R${Number(app.callOutFee).toFixed(2)}` : '—'}</dd>
        <dt className="text-muted-foreground">Submitted</dt>
        <dd>
          {app.submittedAt.toLocaleDateString('en-ZA', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </dd>
        <dt className="text-muted-foreground">ID supplied</dt>
        <dd>{app.idNumber ? 'Yes' : 'No'}</dd>
      </dl>
      {app.notes ? (
        <p className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-xs">
          <span className="font-semibold">Admin notes: </span>
          {app.notes}
        </p>
      ) : null}
    </section>
  )
}

function DrawerEvidence({ app }: { app: ApplicationInput }) {
  if (app.attachments.length === 0 && !app.evidenceNote) return null
  return (
    <section className="space-y-1.5 text-xs">
      <p className="font-semibold uppercase tracking-wider text-muted-foreground">Evidence</p>
      {app.evidenceNote ? <p className="italic text-muted-foreground">“{app.evidenceNote}”</p> : null}
      <ul className="space-y-1">
        {app.attachments.map((att) => {
          const isImage = att.mimeType?.startsWith('image/') && att.safeForPreview
          return (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
            >
              {isImage ? (
                <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <a
                href={`/api/attachments/${att.id}`}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs underline-offset-4 hover:underline"
              >
                {att.label || att.id}
              </a>
              {!att.safeForPreview ? (
                <span className="ml-auto rounded-full border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  unsafe
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DrawerRecovery({ row }: { row: UnifiedApplicationRow }) {
  const recovery = row.recovery!
  return (
    <section className="space-y-1.5 text-xs">
      <p className="font-semibold uppercase tracking-wider text-muted-foreground">Recovery</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Stage</dt>
        <dd>{stageLabel(recovery.stage)}</dd>
        <dt className="text-muted-foreground">Last seen</dt>
        <dd>{formatDateTime(recovery.lastInteractionAt)}</dd>
        <dt className="text-muted-foreground">Follow-up due</dt>
        <dd>{recovery.followUpDueAt ? formatDateTime(recovery.followUpDueAt) : '—'}</dd>
        <dt className="text-muted-foreground">Last outcome</dt>
        <dd>{recovery.lastOutcomeStatus}</dd>
      </dl>
      {row.flags.outsideSessionWindow ? (
        <p className="rounded-md border border-rose-300/40 bg-rose-50/40 p-2 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          Outside the 23h WhatsApp session window — only an approved template can be sent.
        </p>
      ) : null}
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
        {recovery.followUpMessage}
      </pre>
    </section>
  )
}

function DrawerCategoryApproval({
  app,
  actions,
  crudEnabled,
}: {
  app: ApplicationInput
  actions: ApplicationsV2Actions
  crudEnabled: boolean
}) {
  const requested = Array.from(new Set(app.skills.map(resolveCategorySlug))).filter(Boolean)
  if (requested.length === 0) return null
  const statusBySlug = new Map(
    (app.provider?.providerCategories ?? []).map((row) => [row.categorySlug, row.approvalStatus]),
  )
  return (
    <section className="space-y-2 text-xs">
      <p className="font-semibold uppercase tracking-wider text-muted-foreground">
        Category approval
      </p>
      <div className="space-y-1.5">
        {requested.map((slug) => {
          const current = statusBySlug.get(slug) ?? 'PENDING_REVIEW'
          return (
            <div
              key={slug}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/10 px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{slug}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    current === 'APPROVED'
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
                      : current === 'REJECTED'
                        ? 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100'
                        : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                  }`}
                >
                  {current}
                </span>
              </div>
              <div className="flex gap-1">
                {(['APPROVED', 'REJECTED', 'PENDING_REVIEW'] as const).map((next) => (
                  <form key={next} action={actions.updateCategoryApproval}>
                    <input type="hidden" name="id" value={app.id} />
                    <input type="hidden" name="categorySlug" value={slug} />
                    <input type="hidden" name="approvalStatus" value={next} />
                    <SubmitButton
                      size="sm"
                      variant="outline"
                      disabled={!crudEnabled}
                      pendingLabel={
                        next === 'APPROVED'
                          ? 'Approving…'
                          : next === 'REJECTED'
                            ? 'Rejecting…'
                            : 'Holding…'
                      }
                    >
                      {next === 'APPROVED' ? 'Approve' : next === 'REJECTED' ? 'Reject' : 'Hold'}
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DrawerActions({
  row,
  actions,
  crudEnabled,
  templateFlagEnabled,
}: {
  row: UnifiedApplicationRow
  actions: ApplicationsV2Actions
  crudEnabled: boolean
  templateFlagEnabled: boolean
}) {
  const app = row.application
  const canApprove = app && (app.status === 'PENDING' || app.status === 'MORE_INFO_REQUIRED')
  // Rejectable from the same statuses as approvable — a MORE_INFO_REQUIRED
  // application (provider went cold) must be closable from the UI.
  const canReject = app && (app.status === 'PENDING' || app.status === 'MORE_INFO_REQUIRED')
  const approveDisabled =
    !crudEnabled ||
    !canApprove ||
    row.hasConflict ||
    (row.completeness ? !row.completeness.canApprove : true)

  return (
    <section className="space-y-3 border-t border-border pt-3">
      {app && canApprove ? (
        <form action={actions.approve} className="space-y-1">
          <input type="hidden" name="id" value={app.id} />
          <SubmitButton
            size="sm"
            disabled={approveDisabled}
            className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-muted disabled:text-muted-foreground"
            pendingLabel="Approving verification…"
          >
            Approve application
          </SubmitButton>
          {row.hasConflict ? (
            <p className="text-[11px] text-rose-700 dark:text-rose-300">
              Disabled — duplicate active application for this phone.
            </p>
          ) : row.completeness && !row.completeness.canApprove ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Disabled — missing required fields.
            </p>
          ) : null}
        </form>
      ) : null}

      {app && app.status === 'PENDING' ? (
        <form action={actions.requestMoreInfo} className="space-y-1.5">
          <input type="hidden" name="id" value={app.id} />
          <label htmlFor={`more-info-${app.id}`} className="block text-xs font-medium">
            Request more information
          </label>
          <Textarea
            id={`more-info-${app.id}`}
            name="reason"
            required
            minLength={5}
            rows={2}
            placeholder="What information is needed? (min 5 chars)"
            className="text-xs"
          />
          <SubmitButton
            size="sm"
            variant="outline"
            disabled={!crudEnabled}
            className="w-full"
            pendingLabel="Sending WhatsApp request…"
          >
            Send WhatsApp request
          </SubmitButton>
        </form>
      ) : null}

      {canReject ? (
        <form action={actions.reject} className="space-y-1.5">
          <input type="hidden" name="id" value={app.id} />
          <label
            htmlFor={`reject-${app.id}`}
            className="block text-xs font-medium text-rose-700 dark:text-rose-300"
          >
            Reject application
          </label>
          <Textarea
            id={`reject-${app.id}`}
            name="reason"
            required
            minLength={5}
            rows={2}
            placeholder="Reason for rejection (min 5 chars, shown to provider)"
            className="text-xs"
          />
          <SubmitButton
            size="sm"
            variant="outline"
            disabled={!crudEnabled}
            className="w-full border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-300/40 dark:text-rose-200 dark:hover:bg-rose-950/40"
            pendingLabel="Rejecting…"
          >
            Reject
          </SubmitButton>
        </form>
      ) : null}

      {app ? (
        <div className="flex gap-2">
          {row.flags.claimedByCurrentUser ? (
            <form action={actions.release} className="flex-1">
              <input type="hidden" name="id" value={app.id} />
              <SubmitButton
                size="sm"
                variant="outline"
                disabled={!crudEnabled}
                className="w-full"
                pendingLabel="Releasing claim…"
              >
                Release claim
              </SubmitButton>
            </form>
          ) : (
            <form action={actions.claim} className="flex-1">
              <input type="hidden" name="id" value={app.id} />
              <SubmitButton
                size="sm"
                variant="outline"
                disabled={!crudEnabled}
                className="w-full"
                pendingLabel={row.assignment?.claimedById ? 'Taking over…' : 'Claiming…'}
              >
                {row.assignment?.claimedById ? 'Take over' : 'Claim'}
              </SubmitButton>
            </form>
          )}
          {app.provider?.id ? (
            <Link
              href={`/admin/technicians/${app.provider.id}`}
              className="inline-flex flex-1 items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted/50"
            >
              Provider profile
            </Link>
          ) : null}
        </div>
      ) : null}

      {row.recovery && row.recovery.messageTemplateKey !== 'submitted_no_recovery' ? (
        <form action={actions.sendRecoveryNudge} className="space-y-1">
          <input type="hidden" name="safeUserRef" value={row.recovery.safeUserRef} />
          <SubmitButton
            size="sm"
            variant="outline"
            disabled={!crudEnabled}
            className="w-full"
            pendingLabel={
              row.flags.outsideSessionWindow && templateFlagEnabled
                ? 'Sending recovery template…'
                : 'Sending recovery nudge…'
            }
          >
            {row.flags.outsideSessionWindow && templateFlagEnabled
              ? 'Send recovery template'
              : 'Send recovery nudge'}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  filters,
  totalRows,
}: {
  filters: WorklistFilters
  totalRows: number
}) {
  const hasFilter =
    Boolean(filters.bucket) ||
    Boolean(filters.query) ||
    Boolean(filters.source) ||
    Boolean(filters.kyc) ||
    filters.hasIdNumber !== null ||
    filters.hasProfilePhoto !== null ||
    Boolean(filters.claimedOnly) ||
    Boolean(filters.unclaimedOnly)

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">
          {totalRows === 0 ? 'No applications yet.' : 'No applications match these filters.'}
        </p>
        {hasFilter ? (
          <Link
            href="/admin/applications"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Reset filters
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">
            Watch the recovery queue or check the WhatsApp inbound logs.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hrefForFilters(filters: WorklistFilters, extra?: { selected?: string }): string {
  const params = new URLSearchParams(filtersToQueryString(filters))
  if (extra?.selected) params.set('selected', extra.selected)
  const qs = params.toString()
  return qs ? `/admin/applications?${qs}` : '/admin/applications'
}

function groupByBucket(
  rows: UnifiedApplicationRow[],
): Array<[QueueBucket, UnifiedApplicationRow[]]> {
  const groups = new Map<QueueBucket, UnifiedApplicationRow[]>()
  for (const row of rows) {
    const list = groups.get(row.bucket) ?? []
    list.push(row)
    groups.set(row.bucket, list)
  }
  return BUCKET_ORDER.filter((b) => groups.has(b)).map((b) => [b, groups.get(b) ?? []])
}

function resolveCategorySlug(skill: string): string {
  return resolveServiceCategoryTag(skill) ?? skill.toLowerCase().trim().replace(/\s+/g, '_')
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

function formatRelative(date: Date): string {
  const ms = Date.now() - date.getTime()
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ownerLabel(assignment: AssignmentInput | null): string {
  if (!assignment?.claimedById) return 'Unclaimed'
  return assignment.claimedByLabel ? `Claimed by ${assignment.claimedByLabel}` : 'Claimed'
}
