import { randomBytes } from 'crypto'
import {
  PayAtGoAuthError,
  PayAtGoConfigurationError,
  PayAtGoNetworkError,
  PayAtGoProviderError,
  PayAtGoValidationError,
} from './errors'
import {
  type InternalPayAtGoStatus,
  mapPayAtGoAccountStateToInternalStatus,
} from './status'

type TokenCache = {
  token: string
  expiresAt: number
}

type PayAtGoConfig = {
  enabled: boolean
  mockMode: boolean
  baseUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  grantType: string
  scopes: string[]
}

type MockRtpEntry = {
  clientAccountNumber: string
  clientReferenceNumber: string
  requestToPayId: number
  sourceReference: string
  paymentLink: string
  accountState: string
  amountCents: number
  createdAt: string
  expiresAt: string
}

const mockRtpStore = new Map<string, MockRtpEntry>()
let tokenCache: TokenCache | null = null
let tokenInflight: Promise<string> | null = null
const PAYAT_GO_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function parseBoolean(value: string | undefined, defaultValue = false) {
  if (value == null) return defaultValue
  return value.trim().toLowerCase() === 'true'
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new PayAtGoConfigurationError(name)
  }
  return value
}

function parseScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function resolveTokenUrl(baseUrl: string): string {
  try {
    // OpenAPI uses /yapi/oauth/token while API endpoints use /yapi/v1/*.
    // Resolve against the configured API base so custom environments still work.
    return new URL('../oauth/token', baseUrl.replace(/\/?$/, '/')).toString()
  } catch {
    throw new PayAtGoConfigurationError('PAYAT_GO_BASE_URL', 'PAYAT_GO_BASE_URL is not a valid URL.')
  }
}

function getPayAtGoConfig(): PayAtGoConfig {
  const enabled = parseBoolean(process.env.PAYAT_GO_ENABLED, false)
  const mockMode = parseBoolean(process.env.PAYAT_GO_MOCK_MODE, false)
  const baseUrl = requireEnv('PAYAT_GO_BASE_URL').replace(/\/$/, '')
  const clientId = requireEnv('PAYAT_GO_CLIENT_ID')
  const clientSecret = requireEnv('PAYAT_GO_CLIENT_SECRET')
  const grantType = process.env.PAYAT_GO_GRANT_TYPE?.trim() || 'client_credentials'
  const rawScopes = requireEnv('PAYAT_GO_SCOPES')
  const scopes = parseScopes(rawScopes)

  if (grantType !== 'client_credentials') {
    throw new PayAtGoConfigurationError(
      'PAYAT_GO_GRANT_TYPE',
      'PAYAT_GO_GRANT_TYPE must be client_credentials.',
    )
  }

  if (scopes.length === 0) {
    throw new PayAtGoConfigurationError('PAYAT_GO_SCOPES', 'PAYAT_GO_SCOPES must include at least one scope.')
  }

  return {
    enabled,
    mockMode,
    baseUrl,
    tokenUrl: resolveTokenUrl(baseUrl),
    clientId,
    clientSecret,
    grantType,
    scopes,
  }
}

function ensureEnabled(config: PayAtGoConfig) {
  if (!config.enabled) {
    throw new PayAtGoConfigurationError(
      'PAYAT_GO_ENABLED',
      'Pay@Go is disabled. Set PAYAT_GO_ENABLED=true to enable this provider.',
    )
  }
}

function generateClientAccountNumber(): string {
  // Pay@Go accepts a 14-digit numeric account number.
  const randomHex = randomBytes(7).toString('hex')
  const value = BigInt(`0x${randomHex}`) % BigInt('100000000000000')
  return value.toString().padStart(14, '0')
}

function sanitizeProviderErrorBody(raw: string): string {
  if (!raw) return ''
  return raw.slice(0, 500)
}

function getRetryMaxAttempts(): number {
  const raw = Number.parseInt(process.env.PAYAT_GO_RETRY_MAX_ATTEMPTS ?? '', 10)
  if (!Number.isFinite(raw)) return 3
  return Math.min(Math.max(raw, 1), 5)
}

function getRetryBaseDelayMs(): number {
  const raw = Number.parseInt(process.env.PAYAT_GO_RETRY_BASE_DELAY_MS ?? '', 10)
  if (!Number.isFinite(raw)) return 200
  return Math.min(Math.max(raw, 50), 5000)
}

function parseRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after')?.trim()
  if (!retryAfter) return null
  const seconds = Number.parseInt(retryAfter, 10)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const date = new Date(retryAfter)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, date.getTime() - Date.now())
}

function shouldRetryStatus(status: number): boolean {
  return PAYAT_GO_RETRYABLE_STATUSES.has(status)
}

function jitterDelayMs(baseDelayMs: number): number {
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelayMs * 0.25)))
  return baseDelayMs + jitter
}

function computeRetryDelayMs(params: { attempt: number; response?: Response }): number {
  const fromHeader = params.response ? parseRetryAfterMs(params.response) : null
  if (fromHeader != null) return Math.min(fromHeader, 15_000)
  const base = getRetryBaseDelayMs()
  return Math.min(jitterDelayMs(base * (2 ** (params.attempt - 1))), 15_000)
}

async function sleepMs(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

function parseProviderJson(rawBody: string, context: string): Record<string, unknown> {
  if (!rawBody) return {}
  try {
    return JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw new PayAtGoProviderError(`${context} returned invalid JSON.`, undefined, sanitizeProviderErrorBody(rawBody))
  }
}

async function fetchAccessToken(config: PayAtGoConfig): Promise<string> {
  const maxAttempts = getRetryMaxAttempts()
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response
    try {
      response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: config.grantType,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: config.scopes.join(' '),
        }),
        signal: AbortSignal.timeout(8_000),
      })
    } catch (error) {
      if (attempt < maxAttempts) {
        const delayMs = computeRetryDelayMs({ attempt })
        console.warn(JSON.stringify({
          event: 'payat_go.client_retry',
          operation: 'oauth_token',
          attempt,
          delayMs,
          reason: error instanceof Error ? error.name : 'unknown_error',
        }))
        await sleepMs(delayMs)
        continue
      }

      const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown_error'
      throw new PayAtGoNetworkError(`Pay@Go token request failed: ${reason}`)
    }

    if (!response.ok) {
      if (shouldRetryStatus(response.status) && attempt < maxAttempts) {
        const delayMs = computeRetryDelayMs({ attempt, response })
        console.warn(JSON.stringify({
          event: 'payat_go.client_retry',
          operation: 'oauth_token',
          attempt,
          delayMs,
          statusCode: response.status,
          reason: 'http_status_retryable',
        }))
        await sleepMs(delayMs)
        continue
      }

      const body = sanitizeProviderErrorBody(await response.text().catch(() => ''))
      throw new PayAtGoAuthError(
        `Pay@Go authentication failed with HTTP ${response.status}${body ? ` (${body})` : ''}`,
      )
    }

    let payload: { access_token?: string; expires_in?: number }
    try {
      payload = await response.json() as { access_token?: string; expires_in?: number }
    } catch {
      throw new PayAtGoAuthError('Pay@Go token response was not valid JSON.')
    }

    if (!payload.access_token || !Number.isFinite(payload.expires_in)) {
      throw new PayAtGoAuthError('Pay@Go token response is missing access_token or expires_in.')
    }

    tokenCache = {
      token: payload.access_token,
      // Refresh one minute early to avoid near-expiry race conditions.
      expiresAt: Date.now() + Math.max((Number(payload.expires_in) - 60) * 1000, 10_000),
    }

    return tokenCache.token
  }

  throw new PayAtGoNetworkError('Pay@Go token request exhausted retry attempts.')
}

async function getAccessToken(config: PayAtGoConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  if (tokenInflight) return tokenInflight

  tokenInflight = fetchAccessToken(config).finally(() => {
    tokenInflight = null
  })

  return tokenInflight
}

async function payAtGoFetch(
  config: PayAtGoConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const maxAttempts = getRetryMaxAttempts()
  let unauthorizedRetried = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const token = await getAccessToken(config)

    let response: Response
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      if (attempt < maxAttempts) {
        const delayMs = computeRetryDelayMs({ attempt })
        console.warn(JSON.stringify({
          event: 'payat_go.client_retry',
          operation: path,
          attempt,
          delayMs,
          reason: error instanceof Error ? error.name : 'unknown_error',
        }))
        await sleepMs(delayMs)
        continue
      }

      const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown_error'
      throw new PayAtGoNetworkError(`Pay@Go request failed before response: ${reason}`)
    }

    if (response.status === 401 && !unauthorizedRetried) {
      unauthorizedRetried = true
      invalidatePayAtGoTokenCache()
      continue
    }

    if (shouldRetryStatus(response.status) && attempt < maxAttempts) {
      const delayMs = computeRetryDelayMs({ attempt, response })
      console.warn(JSON.stringify({
        event: 'payat_go.client_retry',
        operation: path,
        attempt,
        delayMs,
        statusCode: response.status,
        reason: 'http_status_retryable',
      }))
      await sleepMs(delayMs)
      continue
    }

    return response
  }

  throw new PayAtGoNetworkError(`Pay@Go request exhausted retry attempts for ${path}.`)
}

function parseInternalStatusAsProviderState(status: InternalPayAtGoStatus): string {
  switch (status) {
    case 'SENT':
      return 'PAYMENT_OUTSTANDING'
    case 'PENDING':
      return 'PROCESSING_PAYMENT'
    case 'PAID':
      return 'PAYMENT_COMPLETED'
    case 'FAILED':
      return 'PAYMENT_FEES_ISSUE'
    case 'CANCELLED':
      return 'PAYMENT_CANCELLED'
    case 'EXPIRED':
      return 'PAYMENT_EXPIRED'
    default:
      return 'PAYMENT_OUTSTANDING'
  }
}

export type PayAtGoCreateRtpInput = {
  clientReferenceNumber: string
  amountCents: number
  customerNameSurname: string
  customerMobileNumber?: string
  customerEmail?: string
  description?: string
  notificationNumber?: string
  merchantDisplayName?: string
  daysValid?: number
  clientAccountNumber?: string
}

export type PayAtGoCreateRtpResult = {
  clientAccountNumber: string
  requestToPayId: number | null
  sourceReference: string | null
  paymentLink: string | null
  internalStatus: InternalPayAtGoStatus
  rawProviderStatus: string
  raw: Record<string, unknown>
}

export type PayAtGoReadRtpResult = {
  clientAccountNumber: string
  requestToPayId: number | null
  sourceReference: string | null
  paymentLink: string | null
  accountState: string
  internalStatus: InternalPayAtGoStatus
  amountCents: number | null
  amountPaidCents: number | null
  paidAt: Date | null
  expiresAt: Date | null
  raw: Record<string, unknown>
}

export type PayAtGoCancelRtpResult = {
  clientAccountNumber: string
  internalStatus: InternalPayAtGoStatus
  rawProviderStatus: string
  message: string
  raw: Record<string, unknown>
}

export async function createPayAtGoSingleRtp(
  input: PayAtGoCreateRtpInput,
): Promise<PayAtGoCreateRtpResult> {
  const config = getPayAtGoConfig()
  ensureEnabled(config)

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PayAtGoValidationError('Amount must be a positive integer in cents.')
  }

  if (!input.customerNameSurname?.trim()) {
    throw new PayAtGoValidationError('Customer name is required for Pay@Go RTP creation.')
  }

  if (config.mockMode) {
    const clientAccountNumber = input.clientAccountNumber ?? generateClientAccountNumber()
    const requestToPayId = Number.parseInt(clientAccountNumber.slice(-8), 10)
    const sourceReference = `PAT-${clientAccountNumber.slice(-6)}`
    const paymentLink = `https://go.payat.co.za/mock/pay/${clientAccountNumber}`
    const now = new Date()
    const expires = new Date(now.getTime() + (input.daysValid ?? 3) * 24 * 60 * 60 * 1000)

    mockRtpStore.set(clientAccountNumber, {
      clientAccountNumber,
      clientReferenceNumber: input.clientReferenceNumber,
      requestToPayId,
      sourceReference,
      paymentLink,
      accountState: 'PAYMENT_OUTSTANDING',
      amountCents: input.amountCents,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    })

    return {
      clientAccountNumber,
      requestToPayId,
      sourceReference,
      paymentLink,
      internalStatus: 'SENT',
      rawProviderStatus: 'PAYMENT_OUTSTANDING',
      raw: {
        requestToPayId,
        sourceReference,
        paymentLink,
      },
    }
  }

  const clientAccountNumber = input.clientAccountNumber ?? generateClientAccountNumber()

  const requestBody = {
    clientReferenceNumber: input.clientReferenceNumber,
    clientAccountNumber,
    description: input.description ?? 'Plug A Pro booking payment',
    customerNameSurname: input.customerNameSurname,
    customerMobileNumber: input.customerMobileNumber,
    customerEmail: input.customerEmail,
    amount: input.amountCents,
    minimumAmount: input.amountCents,
    maximumAmount: input.amountCents,
    merchantDisplayName: input.merchantDisplayName ?? 'Plug A Pro',
    notificationNumber: input.notificationNumber ?? input.customerMobileNumber,
    daysValid: input.daysValid ?? 3,
  }

  const response = await payAtGoFetch(config, '/merchant/rtp/create/single', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  const rawBody = await response.text().catch(() => '')

  if (!response.ok) {
    throw new PayAtGoProviderError(
      `Pay@Go RTP create failed with HTTP ${response.status}.`,
      response.status,
      sanitizeProviderErrorBody(rawBody),
    )
  }

  const parsed = parseProviderJson(rawBody, 'Pay@Go RTP create')

  const requestToPayIdRaw = parsed.requestToPayId
  const requestToPayId = typeof requestToPayIdRaw === 'number' && Number.isFinite(requestToPayIdRaw)
    ? requestToPayIdRaw
    : null

  const sourceReferenceRaw = parsed.sourceReference
  const sourceReference = typeof sourceReferenceRaw === 'string' ? sourceReferenceRaw : null

  const paymentLinkRaw = parsed.paymentLink
  const paymentLink = typeof paymentLinkRaw === 'string' ? paymentLinkRaw : null

  return {
    clientAccountNumber,
    requestToPayId,
    sourceReference,
    paymentLink,
    internalStatus: 'SENT',
    rawProviderStatus: 'PAYMENT_OUTSTANDING',
    raw: parsed,
  }
}

function parseSafeDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function parseOptionalInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value)
}

export async function readPayAtGoSingleRtp(
  clientAccountNumber: string,
): Promise<PayAtGoReadRtpResult> {
  const config = getPayAtGoConfig()
  ensureEnabled(config)

  if (!/^\d{1,14}$/.test(clientAccountNumber)) {
    throw new PayAtGoValidationError('Pay@Go clientAccountNumber must be 1-14 numeric digits.')
  }

  if (config.mockMode) {
    const entry = mockRtpStore.get(clientAccountNumber)
    if (!entry) {
      throw new PayAtGoProviderError('Pay@Go mock RTP not found.', 404)
    }

    return {
      clientAccountNumber,
      requestToPayId: entry.requestToPayId,
      sourceReference: entry.sourceReference,
      paymentLink: entry.paymentLink,
      accountState: entry.accountState,
      internalStatus: mapPayAtGoAccountStateToInternalStatus(entry.accountState),
      amountCents: entry.amountCents,
      amountPaidCents: entry.accountState === 'PAYMENT_COMPLETED' ? entry.amountCents : 0,
      paidAt: entry.accountState === 'PAYMENT_COMPLETED' ? new Date() : null,
      expiresAt: new Date(entry.expiresAt),
      raw: {
        clientAccountNumber,
        accountState: entry.accountState,
      },
    }
  }

  const response = await payAtGoFetch(
    config,
    `/merchant/rtp/read/${clientAccountNumber}`,
    { method: 'GET' },
  )

  const rawBody = await response.text().catch(() => '')

  if (!response.ok) {
    throw new PayAtGoProviderError(
      `Pay@Go RTP read failed with HTTP ${response.status}.`,
      response.status,
      sanitizeProviderErrorBody(rawBody),
    )
  }

  const parsed = parseProviderJson(rawBody, 'Pay@Go RTP read')

  const accountState = typeof parsed.accountState === 'string' ? parsed.accountState : 'UNKNOWN'

  return {
    clientAccountNumber,
    requestToPayId: parseOptionalInt(parsed.requestToPayId),
    sourceReference: typeof parsed.sourceReference === 'string' ? parsed.sourceReference : null,
    paymentLink: typeof parsed.paymentLink === 'string' ? parsed.paymentLink : null,
    accountState,
    internalStatus: mapPayAtGoAccountStateToInternalStatus(accountState),
    amountCents: parseOptionalInt(parsed.amount),
    amountPaidCents: parseOptionalInt(parsed.amountPaid),
    paidAt: parseSafeDate(parsed.dateTimePaid),
    expiresAt: parseSafeDate(parsed.dateTimeExpire),
    raw: parsed,
  }
}

export async function cancelPayAtGoSingleRtp(
  clientAccountNumber: string,
): Promise<PayAtGoCancelRtpResult> {
  const config = getPayAtGoConfig()
  ensureEnabled(config)

  if (!/^\d{1,14}$/.test(clientAccountNumber)) {
    throw new PayAtGoValidationError('Pay@Go clientAccountNumber must be 1-14 numeric digits.')
  }

  if (config.mockMode) {
    const entry = mockRtpStore.get(clientAccountNumber)
    if (!entry) {
      throw new PayAtGoProviderError('Pay@Go mock RTP not found.', 404)
    }
    entry.accountState = 'PAYMENT_CANCELLED'
    mockRtpStore.set(clientAccountNumber, entry)

    return {
      clientAccountNumber,
      internalStatus: 'CANCELLED',
      rawProviderStatus: 'PAYMENT_CANCELLED',
      message: 'Cancelled in mock mode.',
      raw: { message: 'Cancelled in mock mode.' },
    }
  }

  const response = await payAtGoFetch(
    config,
    `/merchant/rtp/cancel/single/${clientAccountNumber}`,
    { method: 'PUT' },
  )

  const rawBody = await response.text().catch(() => '')

  if (!response.ok) {
    throw new PayAtGoProviderError(
      `Pay@Go RTP cancel failed with HTTP ${response.status}.`,
      response.status,
      sanitizeProviderErrorBody(rawBody),
    )
  }

  const parsed = parseProviderJson(rawBody, 'Pay@Go RTP cancel')

  return {
    clientAccountNumber,
    internalStatus: 'CANCELLED',
    rawProviderStatus: 'PAYMENT_CANCELLED',
    message: typeof parsed.message === 'string' ? parsed.message : 'Request cancelled.',
    raw: parsed,
  }
}

export function invalidatePayAtGoTokenCache() {
  tokenCache = null
  tokenInflight = null
}

export function setPayAtGoMockStatus(
  clientAccountNumber: string,
  status: InternalPayAtGoStatus,
): void {
  const entry = mockRtpStore.get(clientAccountNumber)
  if (!entry) {
    throw new PayAtGoValidationError('Cannot set mock status for an unknown mock RTP request.')
  }
  entry.accountState = parseInternalStatusAsProviderState(status)
  mockRtpStore.set(clientAccountNumber, entry)
}

export function clearPayAtGoMockStore() {
  mockRtpStore.clear()
}
