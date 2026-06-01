import type {
  ApplicationStatus,
  DisputeStatus,
  IdentityBasis,
  JobRequestStatus,
  JobStatus,
  OpsQueueType,
  PaymentStatus,
  QuoteStatus,
  VerificationAssuranceLevel,
  VerificationChannel,
  VerificationStatus,
} from '@prisma/client'

export type OpsDashboardRangePreset = 'today' | '7d' | '14d' | '30d' | 'custom'

export type OpsDashboardSectionKey = 'hero' | 'queues' | 'trends' | 'exceptions'

export type OpsDashboardErrorCode =
  | 'INVALID_RANGE'
  | 'QUERY_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN'

export type OpsDashboardTone =
  | 'default'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'

export type OpsDashboardQueueKey =
  | 'validation'
  | 'dispatch'
  | 'quoteApprovals'
  | 'fieldExceptions'
  | 'financeFollowUp'
  | 'trustRecovery'
  | 'providerOnboarding'
  | 'identityVerification'

export type OpsDashboardHeroMetricKey =
  | 'requestsNeedingValidation'
  | 'dispatchQueue'
  | 'jobsInField'
  | 'operationalExceptions'

export type OpsDashboardTrendMetricKey =
  | 'requests'
  | 'matches'
  | 'quotes'
  | 'bookings'
  | 'completedJobs'
  | 'paid'
  | 'revenue'

export type OpsDashboardRange = {
  preset: OpsDashboardRangePreset
  from: Date
  to: Date
  label: string
  isCustom: boolean
}

export type OpsDashboardSectionError = {
  code: OpsDashboardErrorCode
  message: string
  recoverable: boolean
}

export type SectionResult<T> = {
  ok: boolean
  data: T | null
  error: OpsDashboardSectionError | null
}

export type OpsDashboardFreshness = {
  generatedAt: Date
  refreshedLabel: string
}

export type OpsDashboardHeroMetric = {
  key: OpsDashboardHeroMetricKey
  label: string
  value: number
  description: string
  drilldownHref: string
  tone: OpsDashboardTone
}

export type OpsDashboardQueueHealth = {
  queueKey: OpsDashboardQueueKey
  queueType: OpsQueueType
  openCount: number
  overdueCount: number
  unclaimedCount: number
  claimedByYouCount: number
  oldestAgeMinutes: number | null
  slaTargetMinutes: number
  tone: OpsDashboardTone
}

export type OpsDashboardQueueCard = {
  key: OpsDashboardQueueKey
  queueType: OpsQueueType
  title: string
  lane: string
  description: string
  href: string
  health: OpsDashboardQueueHealth
}

export type OpsDashboardTrendPoint = {
  date: string
  value: number
}

export type OpsDashboardTrendSeries = {
  key: OpsDashboardTrendMetricKey
  label: string
  points: OpsDashboardTrendPoint[]
}

export type OpsDashboardFunnelMetric = {
  key: OpsDashboardTrendMetricKey
  label: string
  value: number
  note: string
}

export type OpsDashboardIncident = {
  id: string
  section: OpsDashboardSectionKey
  severity: OpsDashboardTone
  message: string
  queueKey?: OpsDashboardQueueKey
  label?: string
  overdueCount?: number
  oldestAgeMinutes?: number
}

export type QueueBreachResult = {
  queueKey: OpsDashboardQueueKey
  label: string
  overdueCount: number
  oldestAgeMinutes: number
  severity: 'warn' | 'breach'
}

export type OpsDashboardHeroSection = {
  freshness: OpsDashboardFreshness
  metrics: OpsDashboardHeroMetric[]
}

// ─── Queue preview items (denormalised for rendering) ────────────────────────

export type JobRequestPreview = {
  id: string
  title: string
  category: string
  status: JobRequestStatus
  expiresAt: Date | null
  createdAt: Date
  customer: { name: string; phone: string }
  address: { suburb: string; city: string } | null
  leadCount?: number
  matchProviderName?: string | null
}

export type QuotePreview = {
  id: string
  amount: number
  validUntil: Date | null
  status: QuoteStatus
  createdAt: Date
  jobRequestTitle: string
  customerName: string
  providerName: string
}

export type JobExceptionPreview = {
  id: string
  status: JobStatus
  failureReason: string | null
  updatedAt: Date
  providerName: string
  jobRequestTitle: string
  customerName: string
  scheduledDate: Date
  scheduledWindow: string | null
}

export type PaymentPreview = {
  id: string
  status: PaymentStatus
  amount: number
  updatedAt: Date
  pspProvider: string | null
  jobRequestTitle: string
  customerName: string
  scheduledDate: Date
}

export type DisputePreview = {
  id: string
  jobId: string
  reason: string
  status: DisputeStatus
  createdAt: Date
  raisedByRole: string
}

export type ProviderApplicationPreview = {
  id: string
  name: string
  phone: string
  skills: string[]
  serviceAreas: string[]
  status: ApplicationStatus
  submittedAt: Date
}

export type IdentityVerificationPreview = {
  id: string
  providerName: string
  providerPhone: string | null
  status: VerificationStatus
  channel: VerificationChannel
  assuranceLevel: VerificationAssuranceLevel
  identityBasis: IdentityBasis
  documentCount: number
  createdAt: Date
  updatedAt: Date
}

// ─── Assignment record (subset needed by dashboard) ──────────────────────────

export type AssignmentRecord = {
  claimedById: string | null
  claimedByLabel: string | null
  claimedAt: Date | null
}

export type OpsDashboardQueueSection = {
  cards: OpsDashboardQueueCard[]
  previews: {
    validation: JobRequestPreview[]
    dispatch: JobRequestPreview[]
    quoteApprovals: QuotePreview[]
    fieldExceptions: JobExceptionPreview[]
    financeFollowUp: PaymentPreview[]
    trustRecovery: DisputePreview[]
    providerOnboarding: ProviderApplicationPreview[]
    identityVerification: IdentityVerificationPreview[]
  }
  assignments: {
    validation: Map<string, AssignmentRecord>
    dispatch: Map<string, AssignmentRecord>
    quoteApprovals: Map<string, AssignmentRecord>
    fieldExceptions: Map<string, AssignmentRecord>
    financeFollowUp: Map<string, AssignmentRecord>
    trustRecovery: Map<string, AssignmentRecord>
    providerOnboarding: Map<string, AssignmentRecord>
    identityVerification: Map<string, AssignmentRecord>
  }
}

export type OpsDashboardTrendSection = {
  funnel: OpsDashboardFunnelMetric[]
  series: OpsDashboardTrendSeries[]
}

export type OpsDashboardExceptionSection = {
  totalExceptions: number
}

export type OpsDashboardSnapshot = {
  range: OpsDashboardRange
  hero: SectionResult<OpsDashboardHeroSection>
  queues: SectionResult<OpsDashboardQueueSection>
  trends: SectionResult<OpsDashboardTrendSection>
  exceptions: SectionResult<OpsDashboardExceptionSection>
  incidents: OpsDashboardIncident[]
}
