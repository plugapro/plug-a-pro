/**
 * Deep-link tokens used by Meta "Click to WhatsApp" CTAs to route ad-driven
 * traffic past the welcome menu.
 *
 * To ship a new ad campaign:
 *   1. Pick a token from DEEPLINK_TOKENS (or add a new entry).
 *   2. In Meta Ads Manager, set the WhatsApp message prefill to the *value*
 *      (e.g. "Register provider").
 *   3. Confirm the bot routes correctly in lib/whatsapp-bot.ts by checking
 *      that matchDeeplink(rawText) returns the expected key for incoming
 *      first messages from the ad.
 *
 * Matching is case-insensitive and prefix-tolerant: we accept exact text or
 * the token followed by trailing whitespace / emoji / locale suffix.
 */

export const DEEPLINK_TOKENS = {
  register_provider: 'Register provider',
} as const

export type DeeplinkKey = keyof typeof DEEPLINK_TOKENS

export function matchDeeplink(rawText: string | null | undefined): DeeplinkKey | null {
  if (!rawText) return null
  const normalized = rawText.trim().toLowerCase()
  if (!normalized) return null
  for (const [key, token] of Object.entries(DEEPLINK_TOKENS) as [DeeplinkKey, string][]) {
    const needle = token.toLowerCase()
    if (normalized === needle || normalized.startsWith(needle + ' ') || normalized.startsWith(needle + '\n')) {
      return key
    }
  }
  return null
}
