import { preferenceLabel } from './client-request-data'
import { PROVIDER_CREDIT_PRICE_ZAR } from './provider-wallet'

export const PROVIDER_TERMS_PATH = '/provider/terms/credits'
export const PROVIDER_APPLY_BUTTON_TITLE = 'Register'
export const PROVIDER_NOT_NOW_BUTTON_TITLE = 'Not Now'
export const PROVIDER_ACCEPTED_LEAD_CREDIT_COST = 1
export const PROVIDER_CREDITS_PRICE_LINE = `1 credit = R${PROVIDER_CREDIT_PRICE_ZAR}.`

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
  const value = process.env[name]
    ?.replace(/\\[rn]/g, '')
    .trim()
  return value || null
}

function validateConfiguredPublicUrl(value: string, resolvedFrom: string) {
  if (!/^https?:\/\//.test(value)) {
    console.error('[provider-credit-copy] CONFIG ERROR: configured public URL is not absolute.', {
      resolvedFrom,
    })
    return ''
  }

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if ((host === 'localhost' || host === '127.0.0.1') && process.env.NODE_ENV === 'production') {
      console.error('[provider-credit-copy] CONFIG ERROR: configured public URL contains localhost in production.', {
        resolvedFrom,
      })
      return ''
    }
    return value
  } catch {
    console.error('[provider-credit-copy] CONFIG ERROR: configured public URL could not be parsed.', {
      resolvedFrom,
    })
    return ''
  }
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
      '[provider-credit-copy] CONFIG ERROR: public app URL contains localhost in production - WhatsApp links will be invalid.',
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

  const trimmedPath = path.trim()
  const normalizedPath = trimmedPath
    ? `/${trimmedPath.replace(/^\/+/, '')}`
    : ''
  return { base: baseValue, path: normalizedPath, resolvedFrom }
}

/**
 * Returns the public app base URL with an optional path appended.
 *
 * Resolution order:
 *   1. APP_PUBLIC_URL          - server-side only; set this in production to the canonical
 *                                public domain (e.g. https://app.plugapro.co.za). Safe to set
 *                                independently of NEXT_PUBLIC_APP_URL so local scripts can
 *                                target production URLs without changing client-side config.
 *   2. NEXT_PUBLIC_APP_URL     - Next.js client-visible variable; typically correct in Vercel
 *                                production builds but may be localhost in local dev.
 *   3. Empty string fallback   - callers receive '' and should not emit a broken public URL.
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
  const configured =
    (configuredUrl('PROVIDER_TERMS_URL') && { name: 'PROVIDER_TERMS_URL', value: configuredUrl('PROVIDER_TERMS_URL')! }) ||
    (configuredUrl('NEXT_PUBLIC_PROVIDER_TERMS_URL') && {
      name: 'NEXT_PUBLIC_PROVIDER_TERMS_URL',
      value: configuredUrl('NEXT_PUBLIC_PROVIDER_TERMS_URL')!,
    })
  if (configured) return validateConfiguredPublicUrl(configured.value, configured.name)
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

export function buildProviderCreditSummaryMessage(
  balance: CreditBalanceBreakdown,
) {
  const starterCredits = balance.promoCreditBalance ?? 0
  const purchasedCredits = balance.paidCreditBalance ?? 0

  return [
    '*Your credits*',
    '',
    `Available: ${balance.totalCreditBalance}`,
    `Starter/onboarding: ${starterCredits}`,
    `Purchased: ${purchasedCredits}`,
    '',
    'Credits are prepaid platform units, not cash, loans or financial credit.',
    PROVIDER_CREDITS_PRICE_LINE,
    'Credits are used only when you accept a customer-selected job.',
    'Previewing, showing interest, shortlisting, customer selection, declining and expiry do not use credits.',
  ].filter(Boolean).join('\n')
}

// Body intentionally contains no raw URL. Caller must pair this with a
// sendCtaUrl follow-up that exposes `getProviderTermsUrl()` behind the
// "View credits rules" CTA - see callers in lib/whatsapp-flows/registration.ts.
export function buildProviderOnboardingIntroMessage() {
  return [
    '👷🏽 *Join Plug A Pro as a Service Provider*',
    '',
    'Get matched with customer job leads in your area.',
    '',
    "*Here's how it works:*",
    '• You apply with your name, skills, work areas and availability.',
    '• We review your application using the information you provide.',
    '• If approved, your provider profile is activated.',
    '• Credits are prepaid platform units, not cash, loans or financial credit.',
    `• ${PROVIDER_CREDITS_PRICE_LINE}`,
    '• You receive starter credits when onboarded.',
    `• Previewing and showing interest in jobs is free.`,
    `• You spend ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)} only when a customer selects you and you accept that selected job.`,
    '• Full customer and job details unlock after selected-job acceptance.',
    '• You can top up credits when your balance runs low.',
    '',
    'Before applying, please review our provider credits terms and rules. Tap *View credits rules* below to read them.',
    '',
    'To register as a provider, tap Register or reply REGISTER.',
    '',
    'Ready to apply?',
  ].join('\n')
}

// Body intentionally contains no raw URL. The `termsUrl` field (param kept for
// backward compatibility with existing call sites) is now ignored in the body.
// Callers must follow up with a sendCtaUrl that exposes the terms URL behind
// the "View credits rules" CTA - see lib/whatsapp-flows/registration.ts.
export function buildProviderApplicationSubmittedMessage(params: {
  providerName?: string | null
  applicationRef: string
  isComingSoonRegion?: boolean
  termsUrl?: string
}) {
  void params.termsUrl // retained for callers; URL travels via the CTA follow-up, not the body
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
    'If approved, your provider profile will be activated and you will receive starter credits for customer-selected jobs you accept.',
    '',
    'Once approved, you can add more profile details - including your email address, portfolio photos and identity verification - in the Worker Portal.',
    '',
    'Provider credits terms and rules are available below - tap *View credits rules* to read them.',
  ].filter(Boolean).join('\n')
}

// Body intentionally contains no URL. The signed lead URL is exposed via the
// dispatch.ts sendCtaUrl call ("View Lead" CTA) - never inline.
export function buildProviderLeadPreviewMessage(params: {
  category: string
  area: string
  preferredTime: string
  deadlineTime: string
  responseWindowMinutes?: number
  balance: CreditBalanceBreakdown
  title?: string | null
  description?: string | null
  subcategory?: string | null
  region?: string | null
  city?: string | null
  province?: string | null
  urgency?: string | null
  // Accepts the stored providerPreference (MVP: save_money | best_value | best_quality) or the
  // legacy budgetPreference field. Rendered via preferenceLabel() - never as a raw enum value.
  matchingPreference?: string | null
  photosCount?: number | null
}) {
  const titleLine = params.title ? [`*${params.title}*`, ''] : []
  const descriptionLine = params.description ? ['', params.description] : []
  const areaParts = [
    params.area,
    params.city,
    params.province,
  ].filter(Boolean)
  const subcategoryLine = params.subcategory ? [`Subcategory: *${params.subcategory}*`] : []
  const regionLine = params.region ? [`Region: *${params.region}*`] : []
  const urgencyLine = params.urgency ? [`Urgency: *${params.urgency}*`] : []
  const budgetLine = params.matchingPreference
    ? [`Matching preference: *${preferenceLabel(params.matchingPreference)}*`]
    : []
  const photosLine = params.photosCount != null ? [`Photos: *${params.photosCount} available*`] : []

  return [
    `🔔 *New Job Opportunity - ${params.category}*`,
    '',
    ...titleLine,
    ...subcategoryLine,
    `Area: *${areaParts.join(', ') || params.area}*`,
    ...regionLine,
    `Preferred time: *${params.preferredTime}*`,
    ...urgencyLine,
    ...budgetLine,
    ...photosLine,
    ...descriptionLine,
    '',
    'The customer is comparing suitable providers. Previewing and responding is free.',
    '',
    `${PROVIDER_CREDITS_PRICE_LINE} You spend ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)} only if the customer selects you and you accept the selected job. Full customer contact and exact address stay locked until then.`,
    `Available credits: ${creditCountLabel(params.balance.totalCreditBalance)} (${providerCreditBreakdownLabel(params.balance)}).`,
    '',
    `You have *${params.responseWindowMinutes ?? 10} minutes* to respond (by *${params.deadlineTime}*).`,
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
    'Showing interest is free while the customer compares providers.',
    `${PROVIDER_CREDITS_PRICE_LINE} You spend ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)} only after customer selection and your final acceptance.`,
    'Full customer details unlock only after selected-job acceptance succeeds.',
    `Available credits: ${creditCountLabel(params.balance.totalCreditBalance)} (${providerCreditBreakdownLabel(params.balance)}).`,
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
    `Remaining credits: ${creditCountLabel(params.remainingCredits)}${breakdown}.`,
  ].join('\n')
}

export function buildInsufficientCreditsMessage(params: {
  availableCredits: number
  creditsRequired?: number
  topupUrl?: string
}) {
  const required = params.creditsRequired ?? PROVIDER_ACCEPTED_LEAD_CREDIT_COST
  void params.topupUrl

  return [
    'Not enough credits.',
    '',
    `You need ${creditCountLabel(required)} to continue with this job.`,
    `Your current balance is ${creditCountLabel(params.availableCredits)}.`,
    'No credit was deducted.',
    'Customer direct contact details remain locked.',
    '',
    'Please top up in the Worker Portal. The top-up link is available below.',
  ].join('\n')
}
