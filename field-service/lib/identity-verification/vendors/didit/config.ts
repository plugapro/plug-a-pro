// Didit identity-verification config loader.
//
// Production: every required key must be set; if any is missing the loader
// throws DiditConfigError. Dev/test: missing keys collapse the loader to
// { enabled: false } so unit tests run without secrets.
//
// Required (production):
//   DIDIT_API_KEY                                 - server-side API key (X-Api-Key header on outbound calls)
//   DIDIT_BASE_URL                                - host, e.g. https://verification.didit.me
//   DIDIT_WEBHOOK_SECRET                          - destination secret used for HMAC verification on inbound webhooks
//   DIDIT_PROVIDER_KYC_WORKFLOW_ID                - basic workflow uuid
//   DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID  - SA-DHA-included workflow uuid (default for provider onboarding)
//
// Optional:
//   DIDIT_SESSION_EXPIRY_HOURS                    - internal session-expiry derivation (Didit does not return expires_at). Default 168 (7 days).
//
// Webhook destination URL is configured in the Didit Console (per-destination)
// rather than passed by us; only the secret is in env.

export const DEFAULT_DIDIT_BASE_URL = 'https://verification.didit.me'
export const DEFAULT_SESSION_EXPIRY_HOURS = 168 // 7 days, per Didit docs

const KNOWN_DIDIT_HOSTS: ReadonlySet<string> = new Set([
  'https://verification.didit.me',
  'https://api.didit.me',
])

export class DiditConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiditConfigError'
  }
}

export type DiditConfig = {
  enabled: true
  baseUrl: string
  apiKey: string
  webhookSecrets: string[]   // comma-separated rotation support; verifier tries each
  workflowIds: {
    basic: string | null
    authoritative: string | null
  }
  sessionExpiryHours: number
} | {
  enabled: false
  reason: string
}

let cached: DiditConfig | null = null

export function getDiditConfig(): DiditConfig {
  if (cached) return cached
  cached = loadDiditConfig()
  return cached
}

// Test-only: lets vitest reset state between tests that vary env.
export function resetDiditConfigCacheForTests(): void {
  cached = null
}

function loadDiditConfig(): DiditConfig {
  const baseUrl = (process.env.DIDIT_BASE_URL?.trim() || DEFAULT_DIDIT_BASE_URL).replace(/\/$/, '')
  const apiKey = process.env.DIDIT_API_KEY?.trim() || null
  const webhookSecretRaw = process.env.DIDIT_WEBHOOK_SECRET?.trim() || null
  const basicWorkflowId = process.env.DIDIT_PROVIDER_KYC_WORKFLOW_ID?.trim() || null
  const authoritativeWorkflowId = process.env.DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID?.trim() || null
  const sessionExpiryHours = Number(process.env.DIDIT_SESSION_EXPIRY_HOURS) || DEFAULT_SESSION_EXPIRY_HOURS

  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction) {
    const missing: string[] = []
    if (!apiKey) missing.push('DIDIT_API_KEY')
    if (!webhookSecretRaw) missing.push('DIDIT_WEBHOOK_SECRET')
    if (!basicWorkflowId && !authoritativeWorkflowId) {
      missing.push('DIDIT_PROVIDER_KYC_WORKFLOW_ID or DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID')
    }
    if (missing.length > 0) {
      throw new DiditConfigError(
        `Didit is enabled but missing required environment variable(s): ${missing.join(', ')}.`,
      )
    }
    const normalizedHost = baseUrl.toLowerCase()
    if (!KNOWN_DIDIT_HOSTS.has(normalizedHost)) {
      throw new DiditConfigError(
        `DIDIT_BASE_URL must be one of ${[...KNOWN_DIDIT_HOSTS].join(', ')} in production; got ${baseUrl}.`,
      )
    }
  }

  if (!apiKey || !webhookSecretRaw || (!basicWorkflowId && !authoritativeWorkflowId)) {
    return {
      enabled: false,
      reason: 'Didit env not configured; running in disabled mode (dev/test only).',
    }
  }

  return {
    enabled: true,
    baseUrl,
    apiKey,
    webhookSecrets: webhookSecretRaw.split(',').map(s => s.trim()).filter(Boolean),
    workflowIds: { basic: basicWorkflowId, authoritative: authoritativeWorkflowId },
    sessionExpiryHours,
  }
}

export type DiditWorkflowProfile = 'KYC_BASIC' | 'KYC_AUTHORITATIVE'

export function getDiditWorkflowId(profile: DiditWorkflowProfile): string {
  const config = getDiditConfig()
  if (!config.enabled) {
    throw new DiditConfigError(`Didit not enabled: ${config.reason}`)
  }
  const id = profile === 'KYC_AUTHORITATIVE'
    ? config.workflowIds.authoritative ?? config.workflowIds.basic
    : config.workflowIds.basic ?? config.workflowIds.authoritative
  if (!id) {
    throw new DiditConfigError(
      `No Didit workflow id configured for profile ${profile}. Set DIDIT_PROVIDER_KYC_WORKFLOW_ID and/or DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID.`,
    )
  }
  return id
}

export function deriveSessionExpiresAt(now: Date = new Date()): Date {
  const config = getDiditConfig()
  const hours = config.enabled ? config.sessionExpiryHours : DEFAULT_SESSION_EXPIRY_HOURS
  return new Date(now.getTime() + hours * 60 * 60 * 1000)
}
