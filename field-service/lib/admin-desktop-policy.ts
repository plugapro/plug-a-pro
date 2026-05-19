export const ADMIN_DOMAIN = 'admin.plugapro.co.za'

const MOBILE_USER_AGENT_PATTERNS = [
  /\bandroid\b/i,
  /\bmobile\b/i,
  /\biphone\b/i,
  /\bipod\b/i,
  /\bblackberry\b/i,
  /\bbb10\b/i,
  /\bwindows phone\b/i,
  /\bopera mini\b/i,
  /\bkindle\b/i,
  /\bsilk\b/i,
  /\bplaybook\b/i,
  /\bi(?:pad|touch)\b/i,
  /\bsm-[a-z0-9]+\b/i,
  /\bgt-p/i,
  /\bnexus (?:7|10|tablet)/i,
]

const TABLET_KEYWORDS = [/\btablet\b/i, /android(?!.*mobile)/i]

export function normalizeHost(rawHost: string | null | undefined): string {
  const host = (rawHost ?? '').split(',')[0].trim().toLowerCase()

  if (!host) return ''

  if (host.startsWith('[')) {
    const closeIndex = host.indexOf(']')
    return closeIndex > 0 ? host.slice(0, closeIndex + 1) : host
  }

  return host.replace(/:\d+$/, '')
}

export function isAdminDomainHost(rawHost: string | null | undefined): boolean {
  return normalizeHost(rawHost) === ADMIN_DOMAIN
}

export function isLikelyMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false

  if (MOBILE_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return true
  }

  return TABLET_KEYWORDS.some((pattern) => pattern.test(userAgent))
}

export function shouldRestrictAdminDomainToDesktop(
  rawHost: string | null | undefined,
  userAgent: string | null | undefined,
): boolean {
  return isAdminDomainHost(rawHost) && isLikelyMobileUserAgent(userAgent)
}
