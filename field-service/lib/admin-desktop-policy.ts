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

// Server-side device heuristic for the mobile-only app gate (used by proxy.ts).
// Conservative by design: only genuine desktop browsers count as desktop;
// unknown/empty UAs, bots, crawlers, previews and monitoring agents are NEVER
// treated as desktop, so they are never blocked.
//
// iPadOS 13+ Safari sends a desktop "Macintosh" UA with no "iPad" token —
// byte-identical to desktop Mac Safari, so the two cannot be told apart by UA
// alone. We fail OPEN for that case (treat as a possible tablet) and let the
// client MobileGate make the final call via pointer/hover + maxTouchPoints.
// Desktop Mac Chrome/Firefox/Edge keep an unambiguous desktop-browser token and
// stay blocked. iOS-only browser tokens (CriOS/FxiOS) never appear on a real Mac.
export function isDesktopBrowserUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  if (/iphone|ipod|android.*mobile|windows phone|blackberry|bb10|opera mini/.test(ua)) return false
  if (/ipad|tablet|silk|playbook|kf[a-z]{2}|sm-t|gt-p|nexus 7|nexus 10|xoom/.test(ua)) return false
  if (/android/.test(ua) && !/mobile/.test(ua)) return false
  if (/crios|fxios/.test(ua)) return false
  if (/bot|crawl|spider|slurp|preview|monitor|curl|wget|headless|lighthouse|pingdom|uptime/.test(ua)) return false
  // Mac Safari is indistinguishable from an iPadOS 13+ Safari UA; fail open and
  // let the client gate decide. Desktop Mac Chrome/Firefox/Edge carry chrome/edg/opr.
  if (/macintosh/.test(ua) && /safari/.test(ua) && !/chrome|chromium|edg|opr/.test(ua)) return false
  return /windows nt|macintosh|cros|x11|linux x86_64/.test(ua)
}
