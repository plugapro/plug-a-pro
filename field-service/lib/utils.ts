import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalise a phone number to E.164 format for deduplication comparisons.
 * - Strips whitespace and hyphens
 * - Converts South African 0xx numbers to +27xx
 * - Returns the cleaned string if it already starts with '+'
 *
 * WhatsApp always delivers numbers in E.164 (+27…) so normalisation is mainly
 * a safety net for admin-entered or import-sourced numbers.
 */
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-()]/g, '')
  if (stripped.startsWith('+')) return stripped
  // South African local format: 0xx → +27xx
  if (stripped.startsWith('0') && stripped.length === 10) {
    return `+27${stripped.slice(1)}`
  }
  // WhatsApp delivers SA numbers without + prefix: 27xxxxxxxxx (11 digits)
  if (stripped.startsWith('27') && stripped.length === 11) {
    return `+${stripped}`
  }
  // Fallback: return stripped (caller should validate E.164 separately)
  return stripped
}

/** Returns a short human-readable age string relative to now ("3m ago", "2h ago", "5d ago"). */
export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
