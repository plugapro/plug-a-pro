// ─── Public health response normalization ─────────────────────────────────────
// Maps machine-readable `/api/health` output into a deterministic model used
// by the public `/status` page. The health endpoint is intentionally minimal;
// anything not explicitly checked is marked as not separately monitored.

export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unknown' | 'not_monitored'

export type HealthSource = 'live check' | 'derived' | 'not_monitored'

export type HealthServiceGroupKey =
  | 'core-platform'
  | 'auth'
  | 'client-journey'
  | 'provider-journey'
  | 'merchant-journey'
  | 'notifications'
  | 'admin-operations'

export type PublicHealthStatusLabel = 'Running' | 'Degraded' | 'Not running' | 'Unknown' | 'Not separately monitored'

export interface RawHealthResponse {
  status?: unknown
  db?: unknown
  timestamp?: unknown
  build?: {
    commitSha?: unknown
    commitShaShort?: unknown
    commitRef?: unknown
    builtAt?: unknown
  }
}

export interface HealthBuildMetadata {
  commitShaShort: string | null
  commitRef: string | null
  builtAt: string | null
}

export interface HealthServiceCheck {
  id: string
  name: string
  impact: string
  status: HealthStatus
  source: HealthSource
}

export interface HealthServiceGroup {
  id: HealthServiceGroupKey
  title: string
  description: string
  status: HealthStatus
  checks: HealthServiceCheck[]
  counts: {
    operational: number
    degraded: number
    down: number
    unknown: number
    notMonitored: number
  }
}

export interface PublicHealthModel {
  lastCheckedAt: string | null
  overallStatus: HealthStatus
  serviceGroups: HealthServiceGroup[]
  robotMessage: string
  build: HealthBuildMetadata
}

export const HEALTH_STATUS_LABELS: Record<HealthStatus, PublicHealthStatusLabel> = {
  operational: 'Running',
  degraded: 'Degraded',
  down: 'Not running',
  unknown: 'Unknown',
  not_monitored: 'Not separately monitored',
}

function toString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function mapEndpointStatus(raw: string | null): HealthStatus {
  if (raw === 'ok') return 'operational'
  if (raw === 'degraded') return 'degraded'
  return 'unknown'
}

function mapDbStatus(raw: string | null): HealthStatus {
  if (raw === 'ok') return 'operational'
  if (raw === 'error') return 'down'
  return 'unknown'
}

function summarizeStatus(values: HealthStatus[]): HealthStatus {
  if (values.length === 0) return 'unknown'
  if (values.some((status) => status === 'down')) return 'down'
  if (values.some((status) => status === 'degraded')) return 'degraded'
  if (values.some((status) => status === 'unknown')) return 'unknown'
  if (values.every((status) => status === 'not_monitored')) return 'not_monitored'
  return 'operational'
}

function summarizeCounts(checks: HealthServiceCheck[]) {
  return checks.reduce(
    (acc, check) => {
      if (check.status === 'operational') acc.operational += 1
      else if (check.status === 'degraded') acc.degraded += 1
      else if (check.status === 'down') acc.down += 1
      else if (check.status === 'unknown') acc.unknown += 1
      else acc.notMonitored += 1
      return acc
    },
    { operational: 0, degraded: 0, down: 0, unknown: 0, notMonitored: 0 },
  )
}

function summarizeOverallStatus(groups: HealthServiceGroup[]): HealthStatus {
  const monitored = groups
    .flatMap((group) => group.checks)
    .filter((check) => check.source !== 'not_monitored')
    .map((check) => check.status)

  if (monitored.length === 0) return 'not_monitored'
  return summarizeStatus(monitored)
}

function toRobotMessage(groups: HealthServiceGroup[], hasHealthFeed: boolean): string {
  if (!hasHealthFeed) {
    return 'I cannot reach the health endpoint right now. Platform status cannot be confirmed.'
  }

  const hasDown = groups.some((group) => group.status === 'down')
  const hasDegraded = groups.some((group) => group.status === 'degraded')
  const hasUnknown = groups.some((group) => group.status === 'unknown')
  const hasUnmonitored = groups.some((group) => group.status === 'not_monitored')

  const core = groups.find((group) => group.id === 'core-platform')
  if (core?.status === 'down' || hasDown) {
    return 'Core platform systems are not fully available. Customer and provider journeys may be affected.'
  }
  if (hasDegraded) {
    return 'Some services are showing a slower or degraded signal. We are monitoring and recovering this continuously.'
  }
  if (hasUnknown) {
    return 'Core platform status is partially unknown. Please check back shortly.'
  }
  if (hasUnmonitored) {
    return 'Core services are running. Some journeys are not separately monitored yet.'
  }
  return 'All core services are running.'
}

function makeNotMonitoredCheck(name: string, impact: string): HealthServiceCheck {
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, impact, status: 'not_monitored', source: 'not_monitored' }
}

function toHealthGroup(
  id: HealthServiceGroupKey,
  title: string,
  description: string,
  checks: HealthServiceCheck[],
): HealthServiceGroup {
  return {
    id,
    title,
    description,
    status: summarizeStatus(checks.map((check) => check.status)),
    checks,
    counts: summarizeCounts(checks),
  }
}

function normalizeBuild(raw: RawHealthResponse['build']): HealthBuildMetadata {
  const candidate = raw ?? {}
  return {
    commitShaShort: toString(candidate.commitShaShort),
    commitRef: toString(candidate.commitRef),
    builtAt: toString(candidate.builtAt),
  }
}

function buildChecks(rawStatus: HealthStatus, dbStatus: HealthStatus, build: HealthBuildMetadata): HealthServiceGroup[] {
  const buildStatus =
    build.commitShaShort || build.commitRef || build.builtAt ? 'operational' : 'unknown'

  const corePlatform = toHealthGroup('core-platform', 'Core Platform', 'Primary platform services required for customer-facing journeys.', [
    { id: 'core-web-app', name: 'Web App', impact: 'Affects page load and navigation across the site.', status: rawStatus, source: 'live check' },
    { id: 'core-api', name: 'Public API', impact: 'Affects API-backed request flow and data loading.', status: rawStatus, source: 'live check' },
    { id: 'core-db', name: 'Database', impact: 'Affects reading/writing customer and provider records.', status: dbStatus, source: 'live check' },
    { id: 'core-health', name: 'Health Endpoint', impact: 'Checks whether platform health reporting is reachable.', status: rawStatus, source: 'live check' },
    { id: 'core-build', name: 'Build / Deployment', impact: 'Shows whether the latest release metadata is available.', status: buildStatus, source: 'derived' },
  ])

  const auth = toHealthGroup('auth', 'Authentication & Access', 'Login and account validation capabilities.', [
    makeNotMonitoredCheck('Login Service', 'Check availability by route in real-time when a real login check is implemented.'),
    makeNotMonitoredCheck('Signup Service', 'Check availability by route in real-time when a real signup check is implemented.'),
    makeNotMonitoredCheck('Session Validation', 'Check availability by route in real-time when a real session-check endpoint exists.'),
    makeNotMonitoredCheck('Password Reset', 'Check availability by route in real-time when customer password recovery is introduced.'),
  ])

  const clientJourney = toHealthGroup('client-journey', 'Client Journey', 'Customer-facing request and booking journeys.', [
    makeNotMonitoredCheck('Browse Services', 'No dedicated backend health check exists yet for catalog and discovery.'),
    makeNotMonitoredCheck('Search Providers', 'No dedicated backend health check exists yet for search ranking.'),
    makeNotMonitoredCheck('View Provider Profile', 'No dedicated backend health check exists yet for profile fetch endpoints.'),
    makeNotMonitoredCheck('Create Booking Request', 'No dedicated backend health check exists yet for booking creation.'),
    makeNotMonitoredCheck('Track Booking Status', 'No dedicated backend health check exists yet for status tracking.'),
    makeNotMonitoredCheck('Messaging / WhatsApp Notification', 'No dedicated backend health check exists yet for outbound messaging.'),
    makeNotMonitoredCheck('Payment Initiation', 'No dedicated backend health check exists yet for payment kickoff.'),
  ])

  const providerJourney = toHealthGroup('provider-journey', 'Provider Journey', 'Provider portal and lead-flow capabilities.', [
    makeNotMonitoredCheck('Provider Registration', 'No dedicated backend health check exists yet for onboarding.'),
    makeNotMonitoredCheck('Provider Login', 'No dedicated backend health check exists yet for provider auth.'),
    makeNotMonitoredCheck('Profile Management', 'No dedicated backend health check exists yet for profile updates.'),
    makeNotMonitoredCheck('Service Listing Management', 'No dedicated backend health check exists yet for service setup pages.'),
    makeNotMonitoredCheck('Job Request Visibility', 'No dedicated backend health check exists yet for lead visibility.'),
    makeNotMonitoredCheck('Accept / Decline Job', 'No dedicated backend health check exists yet for acceptance actions.'),
    makeNotMonitoredCheck('Job Completion Flow', 'No dedicated backend health check exists yet for completion updates.'),
  ])

  const merchantJourney = toHealthGroup('merchant-journey', 'Merchant / Commercial', 'Commercial journey and invoice-like flows.', [
    makeNotMonitoredCheck('Merchant Profile', 'No dedicated backend health check exists yet for commercial profile operations.'),
    makeNotMonitoredCheck('Service Catalogue', 'No dedicated backend health check exists yet for catalogue syncs.'),
    makeNotMonitoredCheck('Pricing / Quote Flow', 'No dedicated backend health check exists yet for quote pricing path.'),
    makeNotMonitoredCheck('Payment Status', 'No dedicated backend health check exists yet for payment result syncs.'),
    makeNotMonitoredCheck('Invoice / Receipt Flow', 'No dedicated backend health check exists yet for invoicing.'),
  ])

  const notifications = toHealthGroup('notifications', 'Notification Journey', 'Out-of-app messaging and alerts.', [
    makeNotMonitoredCheck('Email Notifications', 'No dedicated backend health check exists yet for email delivery.'),
    makeNotMonitoredCheck('SMS Notifications', 'No dedicated backend health check exists yet for SMS delivery.'),
    makeNotMonitoredCheck('WhatsApp Cloud API', 'No dedicated backend health check exists yet for WhatsApp transport health.'),
    makeNotMonitoredCheck('In-App Notifications', 'No dedicated backend health check exists yet for app notification feeds.'),
  ])

  const adminOperations = toHealthGroup('admin-operations', 'Admin / Operations', 'Operational and governance tooling.', [
    makeNotMonitoredCheck('Admin Dashboard', 'No dedicated backend health check exists yet for admin shell availability.'),
    makeNotMonitoredCheck('User Management', 'No dedicated backend health check exists yet for user administration APIs.'),
    makeNotMonitoredCheck('Provider Verification', 'No dedicated backend health check exists yet for verification workflows.'),
    makeNotMonitoredCheck('Dispute / Support Queue', 'No dedicated backend health check exists yet for ticket and case systems.'),
    makeNotMonitoredCheck('Audit / Logs', 'No dedicated backend health check exists yet for audit event processing.'),
  ])

  return [corePlatform, auth, clientJourney, providerJourney, merchantJourney, notifications, adminOperations]
}

/**
 * Build a public-safe health model for the dashboard. This function accepts
 * partial or malformed payloads and returns explicit statuses so the UI never
 * throws on unexpected responses.
 */
export function normalizeHealthResponse(raw: unknown): PublicHealthModel {
  const payload = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
    ? (raw as RawHealthResponse)
    : {}

  const status = mapEndpointStatus(toString(payload.status))
  const dbStatus = mapDbStatus(toString(payload.db))
  const build = normalizeBuild(payload.build)
  const lastCheckedAt = toString(payload.timestamp)

  const serviceGroups = buildChecks(status, dbStatus, build)
  const overallStatus = summarizeOverallStatus(serviceGroups)

  return {
    lastCheckedAt,
    overallStatus,
    serviceGroups,
    build,
    robotMessage: toRobotMessage(serviceGroups, true),
  }
}

/**
 * Use when `/api/health` fails or returns an unparsable payload.
 * This keeps the page recoverable and still user-friendly.
 */
export function healthForUnavailableEndpoint(reason: string, nowIso: string = new Date().toISOString()): PublicHealthModel {
  const fallbackBuild: HealthBuildMetadata = {
    commitShaShort: null,
    commitRef: null,
    builtAt: null,
  }

  const serviceGroups = [
    ...buildChecks('unknown', 'unknown', fallbackBuild),
  ]

  const normalizedGroups = serviceGroups.map((group) => {
    const checks = group.checks.map((check) => {
      const unavailableStatus: HealthStatus = group.id === 'core-platform' ? 'unknown' : 'not_monitored'
      return {
        ...check,
        status: unavailableStatus,
        source: 'not_monitored' as const,
        impact: `${check.impact} (${reason}).`,
      }
    })
    return {
      ...group,
      checks,
      status: summarizeStatus(checks.map((check) => check.status)),
      counts: summarizeCounts(checks),
    }
  })

  return {
    lastCheckedAt: nowIso,
    overallStatus: 'unknown',
    build: fallbackBuild,
    serviceGroups: normalizedGroups,
    robotMessage: `I cannot reach the health endpoint right now. Platform status cannot be confirmed. (${reason})`,
  }
}
