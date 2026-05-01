export const PROVIDER_TERMS_PATH = '/provider/terms/credits'
export const PROVIDER_APPLY_BUTTON_TITLE = 'Yes, Apply Now'
export const PROVIDER_NOT_NOW_BUTTON_TITLE = 'Not Now'
export const PROVIDER_ACCEPTED_LEAD_CREDIT_COST = 1

const DEFAULT_PUBLIC_URL_ENV_VARS = ['APP_PUBLIC_URL', 'NEXT_PUBLIC_APP_URL']
const PROVIDER_LEAD_PUBLIC_URL_ENV_VARS = [
  'PROVIDER_LEAD_APP_URL',
  'NEXT_PUBLIC_PROVIDER_LEAD_APP_URL',
  ...DEFAULT_PUBLIC_URL_ENV_VARS,
]

type CreditBalanceBreakdown = {
  totalCreditBalance: number
  promoCreditBalance?: number
  paidCreditBalance?: number
}

type PublicUrlOptions = {
  fallbackEnvNames?: string[]
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function configuredUrl(name: string) {
  const value = process.env[name]?.trim()
  return value || null
}

function getPublicUrlResolutionContext(envNames: string[]) {
  const configured = envNames
    .map((name) => ({
      name,
      value: configuredUrl(name),
    }))
    .find((item) => item.value)

  if (!configured) return null
  return configured
}

let publicUrlStartupLogged = false

function logPublicUrlConfig(baseUrl: string | null, resolvedFrom: string | null) {
  if (publicUrlStartupLogged) return
  publicUrlStartupLogged = true

  console.info('[provider-credit-copy] public app URL config', {
    resolved: baseUrl ?? '(missing)',
    resolvedFrom: resolvedFrom ?? 'none',
    APP_PUBLIC_URL: configuredUrl('APP_PUBLIC_URL') ? '(set)' : '(missing)',
    NEXT_PUBLIC_APP_URL: configuredUrl('NEXT_PUBLIC_APP_URL') ? '(set)' : '(missing)',
    PROVIDER_LEAD_APP_URL: configuredUrl('PROVIDER_LEAD_APP_URL') ? '(set)' : '(missing)',
    NEXT_PUBLIC_PROVIDER_LEAD_APP_URL: configuredUrl('NEXT_PUBLIC_PROVIDER_LEAD_APP_URL') ? '(set)' : '(missing)',
  })
}

function getPublicAppUrlFromEnv(
  path = '',
  options: PublicUrlOptions = {},
) {
  const fallbackEnvNames = options.fallbackEnvNames && options.fallbackEnvNames.length > 0
    ? options.fallbackEnvNames
    : DEFAULT_PUBLIC_URL_ENV_VARS

  const resolved = getPublicUrlResolutionContext(fallbackEnvNames)
  const resolvedFrom = resolved?.name ?? null
  const baseValue = stripTrailingSlash(resolved?.value ?? '')

  logPublicUrlConfig(baseValue || null, resolvedFrom)

  if (!baseValue) {
    return { base: '', resolvedFrom }
  }

  if (!/^https?:\/\//.test(baseValue)) {
    console.error(
      '[provider-credit-copy] CONFIG ERROR: public app URL is not absolute and may break WhatsApp links.',
      {
        resolvedFrom,
        value: baseValue,
      },
    )
    return { base: '', resolvedFrom }
  }

  const host = (() => {
    try {
      return new URL(baseValue).hostname.toLowerCase()
    } catch (error) {
      console.error(
        '[provider-credit-copy] CONFIG ERROR: public app URL could not be parsed.',
        {
          resolvedFrom,
          value: baseValue,
          error: error instanceof Error ? error.message : String(error),
        },
      )
      return ''
    }
  })()

  if ((host === 'localhost' || host === '127.0.0.1') && process.env.NODE_ENV === 'production') {
    console.error(
      '[provider-credit-copy] CONFIG ERROR: public app URL contains localhost in production — WhatsApp links will be invalid.',
      {
        APP_PUBLIC_URL: process.env.APP_PUBLIC_URL ? '(set)' : '(not set)',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ? '(set)' : '(not set)',
        resolvedFrom,
      },
    )
    return { base: '', resolvedFrom }
  }

  if (!baseValue.includes('://') || !baseValue.startsWith('http')) {
    console.error('[provider-credit-copy] CONFIG ERROR: unexpected public app URL format.')
    return { base: '', resolvedFrom }
  }

  if (process.env.NODE_ENV === 'production' && !process.env.APP_PUBLIC_URL && !process.env.NEXT_PUBLIC_APP_URL) {
    console.error('[provider-credit-copy] CONFIG ERROR: APP_PUBLIC_URL or NEXT_PUBLIC_APP_URL must be set for production WhatsApp links.')
    return { base: '', resolvedFrom }
  }

  if (process.env.NODE_ENV === 'production' && !process.env.APP_PUBLIC_URL) {
    console.warn('[provider-credit-copy] CONFIG NOTE: APP_PUBLIC_URL is not set in production; using NEXT_PUBLIC_APP_URL fallback.')
  }

  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : ''
  return { base: baseValue, path: normalizedPath, resolvedFrom }
}

/**
 * Returns the public app base URL with an optional path appended.
 *
 * Resolution order:
 *   1. APP_PUBLIC_URL          — server-side only; set this in production to the canonical
 *                                public domain (e.g. https://app.plugapro.co.za). Safe to set
 *                                independently of NEXT_PUBLIC_APP_URL so local scripts can
 *                                target production URLs without changing client-side config.
 *   2. NEXT_PUBLIC_APP_URL     — Next.js client-visible variable; typically correct in Vercel
 *                                production builds but may be localhost in local dev.
 *   3. Empty string fallback   — callers receive '' and should not emit a broken public URL.
 *
 * Production guard:
 * - Logs and blocks localhost in production URLs so no broken links are sent.
 * - Returns '' if production has missing or malformed app URL configuration.
 */
export function getPublicAppUrl(path = ''): string {
  const resolved = getPublicAppUrlFromEnv(path)
  if (!resolved.base) return ''
  return `${resolved.base}${resolved.path}`
}

export function getPublicAppUrlWithOptions(path = '', options?: PublicUrlOptions): string {
  const resolved = getPublicAppUrlFromEnv(path, options)
  if (!resolved.base) return ''
  return `${resolved.base}${resolved.path}`
}

export function getProviderTermsUrl(): string {
  const configured = configuredUrl('PROVIDER_TERMS_URL') ?? configuredUrl('NEXT_PUBLIC_PROVIDER_TERMS_URL')
  if (configured) return configured
  return getPublicAppUrlWithOptions(PROVIDER_TERMS_PATH)
}

export function getWorkerPortalUrl(path = '/provider'): string {
  return getPublicAppUrl(path)
}

export function getProviderLeadPublicAppUrl(path = ''): string {
  return getPublicAppUrlWithOptions(path, { fallbackEnvNames: PROVIDER_LEAD_PUBLIC_URL_ENV_VARS })
}

export function creditCountLabel(count: number) {
  return `${count} credit${count === 1 ? '' : 's'}`
}

export function providerCreditBreakdownLabel(balance: CreditBalanceBreakdown) {
  const starterCredits = balance.promoCreditBalance ?? 0
  const purchasedCredits = balance.paidCreditBalance ?? 0

  return `Starter/onboarding: ${starterCredits} · Purchased: ${purchasedCredits}`
}

export function buildProviderOnboardingIntroMessage(termsUrl = getProviderTermsUrl()) {
  return [
    '👷 *Join Plug A Pro as a Service Provider*',
    '',
    'Get matched with customer job leads in your area.',
    '',
    "*Here's how it works:*",
    '• You apply with your name, skills, work areas, and availability.',
    '• We review your application using the information you provide.',
    '• If approved, your provider profile is activated.',
    '• You receive starter credits when onboarded.',
    `• Each lead you accept uses ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)}.`,
    '• Full customer and job details unlock after acceptance.',
    '• You can top up credits when your balance runs low.',
    '',
    'Before applying, please review our provider terms and credit rules:',
    termsUrl,
    '',
    'Ready to apply?',
  ].join('\n')
}

export function buildProviderApplicationSubmittedMessage(params: {
  providerName?: string | null
  applicationRef: string
  isComingSoonRegion?: boolean
  termsUrl?: string
}) {
  const name = params.providerName?.trim().split(/\s+/)[0] || 'there'
  const regionLine = params.isComingSoonRegion
    ? '\n\nThis area is not live yet. We will update you here when Plug A Pro opens leads in this region.'
    : ''

  return [
    '✅ *Application submitted!*',
    '',
    `Thanks, *${name}*. We've received your Plug A Pro provider application.`,
    '',
    `Ref: *${params.applicationRef}*`,
    '',
    'We will review your details and update you here. Approval is not automatic.',
    regionLine.trim(),
    '',
    'If approved, your provider profile will be activated and you will receive starter credits to begin accepting matched leads.',
    '',
    'Provider terms and credit rules:',
    params.termsUrl ?? getProviderTermsUrl(),
  ].filter(Boolean).join('\n')
}

export function buildProviderLeadPreviewMessage(params: {
  category: string
  area: string
  preferredTime: string
  deadlineTime: string
  balance: CreditBalanceBreakdown
  title?: string | null
  description?: string | null
}) {
  const titleLine = params.title ? [`*${params.title}*`, ''] : []
  const descriptionLine = params.description ? ['', params.description] : []

  return [
    `🔔 *New Job Lead — ${params.category}*`,
    '',
    ...titleLine,
    `Area: *${params.area}*`,
    `Preferred time: *${params.preferredTime}*`,
    ...descriptionLine,
    '',
    'You can preview the job details first.',
    '',
    `Accepting this lead uses ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)}. Full customer contact and exact address unlock after acceptance.`,
    `Available balance: ${creditCountLabel(params.balance.totalCreditBalance)} (${providerCreditBreakdownLabel(params.balance)}).`,
    '',
    `Respond by *${params.deadlineTime}*.`,
  ].join('\n')
}

export function buildProviderLeadActionsMessage(params: {
  category: string
  area: string
  balance: CreditBalanceBreakdown
}) {
  return [
    `Quick response for *${params.category}* in *${params.area}*.`,
    '',
    `Accepting this lead uses ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)}.`,
    'Full customer details unlock only after acceptance succeeds.',
    `Available balance: ${creditCountLabel(params.balance.totalCreditBalance)} (${providerCreditBreakdownLabel(params.balance)}).`,
  ].join('\n')
}

export function buildLeadAcceptedCreditLine(params: {
  creditsUsed?: number
  remainingCredits: number
  paidCredits?: number
  starterCredits?: number
}) {
  const creditsUsed = params.creditsUsed ?? PROVIDER_ACCEPTED_LEAD_CREDIT_COST
  const breakdown = params.paidCredits != null || params.starterCredits != null
    ? ` (${providerCreditBreakdownLabel({
        totalCreditBalance: params.remainingCredits,
        paidCreditBalance: params.paidCredits ?? 0,
        promoCreditBalance: params.starterCredits ?? 0,
      })})`
    : ''

  return [
    `${creditCountLabel(creditsUsed)} used.`,
    `Remaining balance: ${creditCountLabel(params.remainingCredits)}${breakdown}.`,
  ].join('\n')
}

export function buildInsufficientCreditsMessage(params: {
  availableCredits: number
  creditsRequired?: number
  topupUrl?: string
}) {
  const required = params.creditsRequired ?? PROVIDER_ACCEPTED_LEAD_CREDIT_COST
  const topupUrl = params.topupUrl ?? getWorkerPortalUrl('/provider/credits')

  return [
    '⚠️ *Not enough credits*',
    '',
    `You need ${creditCountLabel(required)} to accept this lead.`,
    `Your current balance is ${creditCountLabel(params.availableCredits)}.`,
    '',
    'Please top up in the Worker Portal:',
    topupUrl,
  ].join('\n')
}
