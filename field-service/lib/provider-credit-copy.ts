export const PROVIDER_TERMS_PATH = '/provider/terms/credits'
export const PROVIDER_APPLY_BUTTON_TITLE = 'Yes, Apply Now'
export const PROVIDER_NOT_NOW_BUTTON_TITLE = 'Not Now'
export const PROVIDER_ACCEPTED_LEAD_CREDIT_COST = 1

type CreditBalanceBreakdown = {
  totalCreditBalance: number
  promoCreditBalance?: number
  paidCreditBalance?: number
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function configuredUrl(name: string) {
  const value = process.env[name]?.trim()
  return value || null
}

export function getProviderTermsUrl() {
  const configured = configuredUrl('PROVIDER_TERMS_URL') ?? configuredUrl('NEXT_PUBLIC_PROVIDER_TERMS_URL')
  if (configured) return configured

  const appUrl = configuredUrl('NEXT_PUBLIC_APP_URL')
  if (appUrl) return `${stripTrailingSlash(appUrl)}${PROVIDER_TERMS_PATH}`

  return PROVIDER_TERMS_PATH
}

export function getWorkerPortalUrl(path = '/provider') {
  const appUrl = configuredUrl('NEXT_PUBLIC_APP_URL')
  return appUrl ? `${stripTrailingSlash(appUrl)}${path}` : path
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
