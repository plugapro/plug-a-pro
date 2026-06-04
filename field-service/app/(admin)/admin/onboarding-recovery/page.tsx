export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import {
  ONBOARDING_RECOVERY_STAGE_LABELS,
  getProviderOnboardingRecoveryDashboardData,
  type OnboardingRecoveryRow,
  type OnboardingRecoveryStage,
} from '@/lib/provider-onboarding-recovery'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CopyRecoveryMessageButton } from '@/components/admin/onboarding-recovery/CopyRecoveryMessageButton'

export const metadata = buildMetadata({ title: 'Onboarding Recovery', noIndex: true })

type PageSearchParams = Promise<{
  from?: string
  to?: string
  stage?: string
}>

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function parseDateParam(value: string | undefined, fallback: Date) {
  if (!value) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function formatDateTime(value?: Date | null) {
  if (!value) return 'Not recorded'
  return value.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function stageVariant(stage: OnboardingRecoveryStage) {
  if (stage === 'evidence_upload_stuck') return 'danger' as const
  if (stage === 'submitted_approved' || stage === 'completed') return 'success' as const
  if (stage === 'submitted_pending') return 'info' as const
  if (stage === 'flow_conflict') return 'warning' as const
  if (stage === 'unknown') return 'neutral' as const
  return 'brand' as const
}

function stageFromParam(value: string | undefined): OnboardingRecoveryStage | null {
  if (!value) return null
  return Object.prototype.hasOwnProperty.call(ONBOARDING_RECOVERY_STAGE_LABELS, value)
    ? value as OnboardingRecoveryStage
    : null
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function TemplatePreview({ row }: { row: OnboardingRecoveryRow }) {
  if (!row.followUpMessage) {
    return <span className="text-xs text-muted-foreground">No template for this stage</span>
  }

  return (
    <div className="space-y-2">
      <p className="max-w-[36rem] whitespace-pre-line rounded-md border border-border/60 bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
        {row.followUpMessage}
      </p>
      <CopyRecoveryMessageButton
        message={row.followUpMessage}
        stage={row.stage}
        phoneTail={row.phoneTail}
        maskedPhone={row.maskedPhone}
        conversationId={row.conversationId}
        applicationId={row.applicationId}
      />
    </div>
  )
}

export default async function OnboardingRecoveryPage({
  searchParams,
}: {
  searchParams: PageSearchParams
}) {
  await requireAdmin()
  const params = await searchParams
  const now = new Date()
  const from = parseDateParam(params.from, startOfToday())
  const to = parseDateParam(params.to, now)
  const selectedStage = stageFromParam(params.stage)
  const { rows, report } = await getProviderOnboardingRecoveryDashboardData({ from, to })
  const visibleRows = selectedStage ? rows.filter((row) => row.stage === selectedStage) : rows
  const rangeQuery = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`

  const summaryItems = [
    ['Total inbound WhatsApp users', report.totalInboundWhatsAppUsers],
    ['Welcome menu shown', report.welcomeMenuShown],
    ['Idle/welcome', report.dropOffCounts.idle_welcome],
    ['Register tapped, no name', report.dropOffCounts.register_no_name],
    ['ID verification stuck', report.dropOffCounts.id_verification_stuck],
    ['Skills picker stuck', report.dropOffCounts.skills_picker_stuck],
    ['City/location stuck', report.dropOffCounts.location_picker_stuck],
    ['Evidence upload stuck', report.dropOffCounts.evidence_upload_stuck],
    ['Flow conflict', report.dropOffCounts.flow_conflict],
    ['Submitted pending', report.dropOffCounts.submitted_pending],
    ['Submitted approved', report.dropOffCounts.submitted_approved],
    ['Completed', report.dropOffCounts.completed],
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Provider Onboarding Recovery</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop-off recovery pipeline for WhatsApp provider onboarding. Phones are masked and sensitive verification data is excluded.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Range: {formatDateTime(from)} to {formatDateTime(to)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/admin/onboarding-recovery/report?${rangeQuery}`}>Export JSON</Link>
          </Button>
          {selectedStage ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/admin/onboarding-recovery?${rangeQuery}`}>Clear stage</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {summaryItems.map(([label, value]) => (
          <SummaryCard key={label} label={label} value={value} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(ONBOARDING_RECOVERY_STAGE_LABELS) as OnboardingRecoveryStage[]).map((stage) => (
          <Link
            key={stage}
            href={`/admin/onboarding-recovery?${rangeQuery}&stage=${stage}`}
            className="inline-flex"
          >
            <Badge variant={selectedStage === stage ? 'brand' : stageVariant(stage)}>
              {ONBOARDING_RECOVERY_STAGE_LABELS[stage]} · {report.dropOffCounts[stage]}
            </Badge>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Recovery rows ({visibleRows.length})
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Priority order: evidence upload, mid-flow users, register-no-name, idle welcome, flow conflict, submitted pending.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Last message</TableHead>
                <TableHead>State update</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recommended action</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={`${row.phoneTail}-${row.conversationId ?? row.applicationId ?? row.stage}`}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="font-medium">{row.maskedPhone}</p>
                      <p className="text-xs text-muted-foreground">Tail {row.phoneTail}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={stageVariant(row.stage)}>{row.label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(row.lastMessageAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(row.lastStateUpdateAt)}</TableCell>
                  <TableCell className="text-sm">{row.source ?? 'Unknown'}</TableCell>
                  <TableCell className="text-sm">{row.providerCategory ?? 'Unknown'}</TableCell>
                  <TableCell className="text-sm">{row.area ?? 'Unknown'}</TableCell>
                  <TableCell className="text-sm">{row.applicationStatus ?? 'None'}</TableCell>
                  <TableCell className="min-w-64 text-sm">{row.recommendedNextAction}</TableCell>
                  <TableCell>
                    <TemplatePreview row={row} />
                  </TableCell>
                  <TableCell>
                    {row.applicationId ? (
                      <Button asChild variant="ghost" size="xs">
                        <Link href="/admin/applications">Applications</Link>
                      </Button>
                    ) : row.conversationId ? (
                      <span className="text-xs text-muted-foreground">Session {row.conversationId.slice(-6)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                    No onboarding recovery rows found for this range.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
