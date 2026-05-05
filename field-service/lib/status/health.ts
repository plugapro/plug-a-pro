export const STATUS_LABELS = {
  operational: 'Running',
  degraded: 'Degraded',
  down: 'Not running',
  unknown: 'Unknown',
  not_monitored: 'Not separately monitored',
} as const

export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unknown' | 'not_monitored'
export type HealthSource = 'live check' | 'derived' | 'not monitored'

interface RawHealthPayload {
  status?: unknown
  db?: unknown
  timestamp?: unknown
  build?: unknown
}

interface RawBuildPayload {
  commitSha?: unknown
  commitShaShort?: unknown
  commitRef?: unknown
  builtAt?: unknown
}

export interface HealthService {
  id: string
  name: string
  status: HealthStatus
  source: HealthSource
  summary: string
  impact: string
  details: string
}

export interface HealthServiceGroup {
  id: string
  name: string
  services: HealthService[]
}

export interface HealthBuildSummary {
  commitShaShort: string | null
  commitRef: string | null
  builtAt: string | null
}

export interface HealthDashboardModel {
  asOf: string
  overall: HealthStatus
  healthEndpoint: HealthStatus
  database: HealthStatus
  platform: HealthStatus
  groups: HealthServiceGroup[]
  build: HealthBuildSummary
  botMessage: string
}

const BASE_CHECK_DEFAULT = 'unknown'

const defaultBuildSummary: HealthBuildSummary = {
  commitShaShort: null,
  commitRef: null,
  builtAt: null,
}

const groupStatusOrder: HealthStatus[] = ['down', 'degraded', 'unknown', 'not_monitored', 'operational']

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

function normalizeStatus(value: unknown): HealthStatus {
  const normalized = normalizeString(value)?.toLowerCase()
  if (normalized === 'ok') return 'operational'
  if (normalized === 'error') return 'down'
  if (normalized === 'degraded') return 'degraded'
  return BASE_CHECK_DEFAULT
}

function mergeStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('down')) return 'down'
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('unknown')) return 'unknown'
  if (statuses.includes('not_monitored')) return 'not_monitored'
  return 'operational'
}

function hasBuildMetadata(build: unknown): build is RawBuildPayload {
  return typeof build === 'object' && build !== null
}

function normalizeBuildSummary(build: unknown): HealthBuildSummary {
  if (!hasBuildMetadata(build)) return defaultBuildSummary

  return {
    commitShaShort: normalizeString(build.commitShaShort) ?? (normalizeString(build.commitSha)?.slice(0, 7) ?? null),
    commitRef: normalizeString(build.commitRef),
    builtAt: normalizeString(build.builtAt),
  }
}

function formatTimestamp(value: unknown, fallbackIso: string): string {
  if (typeof value === 'string' && value.trim()) return value
  return fallbackIso
}

function derivePlatformStatus(healthStatus: HealthStatus, dbStatus: HealthStatus): HealthStatus {
  return mergeStatus([healthStatus, dbStatus])
}

function inferFromPlatform(baseStatus: HealthStatus): HealthStatus {
  if (baseStatus === 'operational') return 'operational'
  if (baseStatus === 'degraded') return 'degraded'
  if (baseStatus === 'down') return 'down'
  return baseStatus
}

function buildNotMonitoredService(id: string, name: string, details: string, impact: string): HealthService {
  return {
    id,
    name,
    status: 'not_monitored',
    source: 'not monitored',
    summary: STATUS_LABELS.not_monitored,
    impact,
    details,
  }
}

function buildGroupStatusSummary(group: HealthServiceGroup): {
  operational: number
  degraded: number
  down: number
  unknown: number
  notMonitored: number
  overall: HealthStatus
} {
  const counts = group.services.reduce(
    (acc, service) => {
      if (service.status === 'operational') acc.operational += 1
      else if (service.status === 'degraded') acc.degraded += 1
      else if (service.status === 'down') acc.down += 1
      else if (service.status === 'not_monitored') acc.notMonitored += 1
      else acc.unknown += 1
      return acc
    },
    { operational: 0, degraded: 0, down: 0, unknown: 0, notMonitored: 0 }
  )

  const ordered: HealthStatus[] = groupStatusOrder.filter(
    (status) => {
      if (status === 'not_monitored') return counts.notMonitored > 0
      if (status === 'operational') return counts.operational > 0
      if (status === 'degraded') return counts.degraded > 0
      if (status === 'down') return counts.down > 0
      return counts.unknown > 0
    },
  )

  return {
    ...counts,
    overall: ordered.length > 0 ? ordered[0] : 'unknown',
  }
}

export function summarizeGroups(groups: HealthServiceGroup[]): HealthServiceGroup[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    services: group.services,
  }))
}

function buildBotMessage(overall: HealthStatus, platform: HealthStatus): string {
  if (platform === 'down') {
    return "Login and API checks are not responding. Customer and provider journeys may be affected."
  }

  if (platform === 'degraded') {
    return 'Some core checks are degraded. We are monitoring the issue and customer journeys may be slower.'
  }

  if (platform === 'operational') {
    if (overall === 'operational') {
      return 'All core services are running.'
    }
    return 'Core services are mostly running, with a few checks still warming up.'
  }

  return 'I cannot verify the latest platform health right now, but the latest saved signals are displayed.'
}

export function normalizeHealthPayload(raw: unknown): HealthDashboardModel {
  const body = raw as RawHealthPayload | null
  const nowIso = new Date().toISOString()

  const dbStatus = normalizeStatus(body?.db)
  const healthStatus = normalizeStatus(body?.status)
  const endpointStatus = healthStatus
  const platformStatus = derivePlatformStatus(healthStatus, dbStatus)
  const build = normalizeBuildSummary(body?.build)

  const buildStatus: HealthStatus = build.commitShaShort || build.commitRef || build.builtAt
    ? platformStatus
    : 'not_monitored'

  const coreServices: HealthService[] = [
    {
      id: 'web-app',
      name: 'Web App',
      status: platformStatus,
      source: 'derived',
      summary: STATUS_LABELS[platformStatus],
      impact: 'Static pages and authenticated journeys should be reachable.',
      details: 'Customer and provider screens.',
    },
    {
      id: 'public-api',
      name: 'Public API',
      status: endpointStatus,
      source: 'live check',
      summary: STATUS_LABELS[endpointStatus],
      impact: 'Mobile flows, booking actions, and API calls rely on this.',
      details: 'Computed from /api/health status.',
    },
    {
      id: 'database',
      name: 'Database',
      status: dbStatus,
      source: 'live check',
      summary: STATUS_LABELS[dbStatus],
      impact: 'Bookings, leads, and state transitions require DB access.',
      details: 'Computed from /api/health DB check.',
    },
    {
      id: 'build-deployment',
      name: 'Build / Deployment',
      status: buildStatus,
      source: buildStatus === 'not_monitored' ? 'not monitored' : 'derived',
      summary: STATUS_LABELS[buildStatus],
      impact: 'Recent deployment data helps identify rollout context.',
      details: build.commitRef ? `Running branch: ${build.commitRef}` : 'No deployment metadata yet.',
    },
    {
      id: 'health-endpoint',
      name: 'Health Endpoint',
      status: endpointStatus,
      source: 'live check',
      summary: STATUS_LABELS[endpointStatus],
      impact: 'Machine-readable service checks are available on /api/health.',
      details: endpointStatus === 'operational' ? 'Endpoint returned a valid health response.' : 'Endpoint indicates an issue.',
    },
  ]

  const coreGroup: HealthServiceGroup = {
    id: 'core-platform',
    name: 'Core Platform',
    services: coreServices,
  }

  const authStatus = inferFromPlatform(platformStatus)

  const authGroup: HealthServiceGroup = {
    id: 'auth-access',
    name: 'Authentication & Access',
    services: [
      {
        id: 'login-service',
        name: 'Login Service',
        status: authStatus,
        source: 'derived',
        summary: STATUS_LABELS[authStatus],
        impact: 'Customers and providers can request OTP sign-in.',
        details: 'Derived from core platform health.',
      },
      {
        id: 'signup-service',
        name: 'Signup Service',
        status: authStatus,
        source: 'derived',
        summary: STATUS_LABELS[authStatus],
        impact: 'New customer and provider users can join flows when available.',
        details: 'Derived from core platform health.',
      },
      {
        id: 'session-validation',
        name: 'Session Validation',
        status: authStatus,
        source: 'derived',
        summary: STATUS_LABELS[authStatus],
        impact: 'Authenticated sessions are validated before protected actions.',
        details: 'Derived from core platform health.',
      },
      {
        id: 'password-reset',
        name: 'Password Reset',
        status: 'not_monitored',
        source: 'not monitored',
        summary: STATUS_LABELS.not_monitored,
        impact: 'No dedicated health signal for this path yet.',
        details: 'Not separately monitored yet.',
      },
    ],
  }

  const clientGroup: HealthServiceGroup = {
    id: 'client-journey',
    name: 'Client Journey',
    services: [
      buildNotMonitoredService('search-services', 'Browse Services', 'Not separately monitored yet.', 'Service listing UI and search filters for clients are not directly health-checked yet.'),
      buildNotMonitoredService('provider-search', 'Search Providers', 'Not separately monitored yet.', 'Provider search availability is inferred from platform health in the API layer.'),
      buildNotMonitoredService('provider-profile-view', 'View Provider Profile', 'Not separately monitored yet.', 'Profile fetches use standard authenticated API calls.'),
      buildNotMonitoredService('create-booking', 'Create Booking Request', 'Not separately monitored yet.', 'Request creation depends on queue and matching pipelines after submission.'),
      buildNotMonitoredService('track-booking', 'Track Booking Status', 'Not separately monitored yet.', 'Tracking status uses booking and request data persistence.'),
      buildNotMonitoredService('whatsapp-messaging', 'Messaging / WhatsApp Notification', 'Not separately monitored yet.', 'No dedicated runtime signal in /api/health yet.'),
      buildNotMonitoredService('payment-initiation', 'Payment Initiation', 'Not separately monitored yet.', 'No direct payment health probe is attached here.'),
    ],
  }

  const providerGroup: HealthServiceGroup = {
    id: 'provider-journey',
    name: 'Provider Journey',
    services: [
      buildNotMonitoredService('provider-registration', 'Provider Registration', 'Not separately monitored yet.', 'Onboarding relies on form submission and application review flow.'),
      buildNotMonitoredService('provider-login', 'Provider Login', 'Not separately monitored yet.', 'Provider portal auth path is protected by provider middleware rules.'),
      buildNotMonitoredService('provider-profile-management', 'Profile Management', 'Not separately monitored yet.', 'Provider profile edits are standard database operations.'),
      buildNotMonitoredService('service-listing', 'Service Listing Management', 'Not separately monitored yet.', 'Listing and area settings are not separately probed.'),
      buildNotMonitoredService('job-visibility', 'Job Request Visibility', 'Not separately monitored yet.', 'Provider matching visibility depends on dispatch jobs and offers.'),
      buildNotMonitoredService('accept-decline', 'Accept / Decline Job', 'Not separately monitored yet.', 'No dedicated acceptance probe is currently exposed in /api/health.'),
      buildNotMonitoredService('job-completion', 'Job Completion Flow', 'Not separately monitored yet.', 'Execution flow health is monitored in support tooling and ops dashboards.'),
    ],
  }

  const merchantGroup: HealthServiceGroup = {
    id: 'merchant-journey',
    name: 'Merchant / Commercial Journey',
    services: [
      buildNotMonitoredService('merchant-profile', 'Merchant Profile', 'Not separately monitored yet.', 'No dedicated merchant-specific probe exists here.'),
      buildNotMonitoredService('service-catalogue', 'Service Catalogue', 'Not separately monitored yet.', 'Catalogue data is read from shared service records.'),
      buildNotMonitoredService('pricing-quote', 'Pricing / Quote Flow', 'Not separately monitored yet.', 'Quote status changes are currently operationally monitored via internal queues.'),
      buildNotMonitoredService('payment-status', 'Payment Status', 'Not separately monitored yet.', 'Payment status is not surfaced in the public health model yet.'),
      buildNotMonitoredService('invoice-receipt', 'Invoice / Receipt Flow', 'Not separately monitored yet.', 'Receipt generation depends on job completion and billing sync jobs.'),
    ],
  }

  const notificationGroup: HealthServiceGroup = {
    id: 'notification-journey',
    name: 'Notification Journey',
    services: [
      buildNotMonitoredService('email-notifications', 'Email Notifications', 'Not separately monitored yet.', 'No SMTP/transmission probe in /api/health.'),
      buildNotMonitoredService('sms-notifications', 'SMS Notifications', 'Not separately monitored yet.', 'No SMS probe in /api/health.'),
      buildNotMonitoredService('whatsapp-cloud', 'WhatsApp Cloud API', 'Not separately monitored yet.', 'WhatsApp flow health is not currently exposed in public checks.'),
      buildNotMonitoredService('in-app-notifications', 'In-App Notifications', 'Not separately monitored yet.', 'No dedicated UI notification heartbeat here.'),
    ],
  }

  const adminGroup: HealthServiceGroup = {
    id: 'admin-operations',
    name: 'Admin / Operations',
    services: [
      buildNotMonitoredService('admin-dashboard', 'Admin Dashboard', 'Not separately monitored yet.', 'Ops controls are validated by internal admin use and logs.'),
      buildNotMonitoredService('user-management', 'User Management', 'Not separately monitored yet.', 'No dedicated admin auth probe in this endpoint.'),
      buildNotMonitoredService('provider-verification', 'Provider Verification', 'Not separately monitored yet.', 'Verification workflow status is exposed in admin operations tooling.'),
      buildNotMonitoredService('dispute-support', 'Dispute / Support Queue', 'Not separately monitored yet.', 'Queue health is tracked in internal dashboard tooling.'),
      buildNotMonitoredService('audit-logs', 'Audit / Logs', 'Not separately monitored yet.', 'No public audit endpoint is attached to /api/health.'),
    ],
  }

  const botMessage = buildBotMessage(platformStatus, platformStatus)
  const groups = summarizeGroups([
    coreGroup,
    authGroup,
    clientGroup,
    providerGroup,
    merchantGroup,
    notificationGroup,
    adminGroup,
  ])

  return {
    asOf: formatTimestamp(body?.timestamp, nowIso),
    overall: platformStatus,
    healthEndpoint: endpointStatus,
    database: dbStatus,
    platform: platformStatus,
    groups,
    build,
    botMessage,
  }
}

export function buildFallbackHealthModel(errorMessage = 'Health endpoint unreachable'): HealthDashboardModel {
  const nowIso = new Date().toISOString()
  const unknownBase: HealthStatus = 'unknown'
  const serviceGroups: HealthServiceGroup[] = [
    {
      id: 'core-platform',
      name: 'Core Platform',
      services: [
        {
          id: 'web-app',
          name: 'Web App',
          status: unknownBase,
          source: 'derived',
          summary: STATUS_LABELS.unknown,
          impact: 'Cannot verify right now.',
          details: errorMessage,
        },
        {
          id: 'public-api',
          name: 'Public API',
          status: unknownBase,
          source: 'not monitored',
          summary: STATUS_LABELS.unknown,
          impact: 'Unable to verify API status.',
          details: errorMessage,
        },
        {
          id: 'database',
          name: 'Database',
          status: unknownBase,
          source: 'not monitored',
          summary: STATUS_LABELS.unknown,
          impact: 'Unable to verify database status.',
          details: errorMessage,
        },
        {
          id: 'build-deployment',
          name: 'Build / Deployment',
          status: unknownBase,
          source: 'not monitored',
          summary: STATUS_LABELS.unknown,
          impact: 'Unable to verify deployment metadata.',
          details: errorMessage,
        },
        {
          id: 'health-endpoint',
          name: 'Health Endpoint',
          status: unknownBase,
          source: 'not monitored',
          summary: STATUS_LABELS.unknown,
          impact: 'Endpoint call failed.',
          details: errorMessage,
        },
      ],
    },
  ]
  return {
    asOf: nowIso,
    overall: unknownBase,
    healthEndpoint: unknownBase,
    database: unknownBase,
    platform: unknownBase,
    groups: serviceGroups,
    build: defaultBuildSummary,
    botMessage: "I cannot reach the health endpoint right now. Platform status cannot be confirmed.",
  }
}

export function serviceStatusSummary(services: HealthService[]): string {
  return services.map((service) => service.summary).join(', ')
}

export function summarizeGroup(services: HealthService[]) {
  return buildGroupStatusSummary({
    id: '',
    name: '',
    services,
  })
}

export const statusToneFromCheck: Record<HealthStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  operational: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'neutral',
  not_monitored: 'neutral',
}

export const statusSourceLabel: Record<HealthSource, string> = {
  'live check': 'live check',
  derived: 'derived',
  'not monitored': 'not separately monitored',
}
