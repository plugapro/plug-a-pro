import type { VerificationChannel } from '@prisma/client'

export type CompletionCta = {
  label: string
  href: string
  external: boolean
}

export type CompletionAction = {
  primary: CompletionCta
  secondary: CompletionCta
  followUpCopy: string
}

export type ResolveCompletionInput = {
  channel: VerificationChannel | null | undefined
  whatsappDeeplink: string
  dashboardHref?: string
  helpHref?: string
}

const DEFAULT_DASHBOARD_HREF = '/provider'
const DEFAULT_HELP_HREF = '/provider/verification'

export function resolveVerificationCompletionAction(input: ResolveCompletionInput): CompletionAction {
  const dashboardHref = sanitizeInternalHref(input.dashboardHref, DEFAULT_DASHBOARD_HREF)
  const helpHref = sanitizeInternalHref(input.helpHref, DEFAULT_HELP_HREF)
  const whatsappHref = sanitizeWhatsappHref(input.whatsappDeeplink)

  if (input.channel === 'WHATSAPP') {
    return {
      primary: whatsappHref
        ? { label: 'Back to WhatsApp', href: whatsappHref, external: true }
        : { label: 'Back to Plug A Pro', href: dashboardHref, external: false },
      secondary: { label: 'Verification help', href: helpHref, external: false },
      followUpCopy:
        "Plug A Pro will message you in WhatsApp when there's an update. You can close this page.",
    }
  }

  if (input.channel === 'PWA' || input.channel === 'ADMIN' || input.channel === 'VENDOR') {
    return {
      primary: { label: 'Back to Plug A Pro', href: dashboardHref, external: false },
      secondary: { label: 'Verification help', href: helpHref, external: false },
      followUpCopy:
        'We will update you once the review is complete. You can return to Plug A Pro or close this page.',
    }
  }

  // null or unknown channel -> neutral fallback that never assumes WhatsApp,
  // but does offer WhatsApp support as the secondary recovery path when a
  // deeplink is available.
  return {
    primary: { label: 'Back to Plug A Pro', href: dashboardHref, external: false },
    secondary: whatsappHref
      ? { label: 'Open WhatsApp support', href: whatsappHref, external: true }
      : { label: 'Verification help', href: helpHref, external: false },
    followUpCopy:
      'We will update you once the review is complete. You can return to Plug A Pro or contact support if needed.',
  }
}

function sanitizeInternalHref(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback
  // Only allow internal absolute paths. No scheme, no protocol-relative, no traversal.
  if (!candidate.startsWith('/')) return fallback
  if (candidate.startsWith('//')) return fallback
  return candidate
}

function sanitizeWhatsappHref(candidate: string): string {
  if (!candidate) return ''
  // Only honour an explicit https://wa.me deeplink. Anything else (including
  // attacker-controlled query params) collapses to empty so the caller falls
  // back to the safe internal CTA.
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:') return ''
    if (url.hostname !== 'wa.me' && url.hostname !== 'api.whatsapp.com') return ''
    return url.toString()
  } catch {
    return ''
  }
}
