// ─── Central WhatsApp customer copy + CTA link primitives ────────────────────
// Why this exists:
//   1. Body text in customer-facing WhatsApp messages must NEVER contain raw
//      URLs. URLs travel via Cloud-API URL buttons (sendCtaUrl, sendButtons
//      with template URL components, etc.) — never inline.
//   2. App-centred phrasing like "Shall I continue?" reads as the bot asking
//      permission for itself. Customer-centred phrasing ("Should we continue?")
//      makes the journey feel collaborative.
// Both rules are enforced by guards exported from this file and by the lint
// test in __tests__/lib/whatsapp-copy.test.ts so that regressions fail loudly.

// ─── CTA link types ──────────────────────────────────────────────────────────

export type WhatsAppCtaPurpose =
  | 'credit_policy'
  | 'provider_terms'
  | 'application_status'
  | 'worker_portal'
  | 'booking_view'
  | 'quote_view'
  | 'quote_approval'
  | 'payment'
  | 'invoice_view'
  | 'receipt_view'
  | 'job_card'
  | 'support'
  | 'generic_details'

export type WhatsAppCtaLink = {
  id?: string
  label: string
  url: string
  purpose: WhatsAppCtaPurpose
}

const CTA_LABELS: Record<WhatsAppCtaPurpose, string> = {
  credit_policy: 'View credit policy',
  provider_terms: 'View terms',
  application_status: 'Check status',
  worker_portal: 'Open dashboard',
  booking_view: 'View booking',
  quote_view: 'View quote',
  quote_approval: 'Approve quote',
  payment: 'Make payment',
  invoice_view: 'View invoice',
  receipt_view: 'View receipt',
  job_card: 'View job card',
  support: 'Contact support',
  generic_details: 'View details',
}

export function ctaLabelFor(purpose: WhatsAppCtaPurpose): string {
  return CTA_LABELS[purpose]
}

export function ctaLink(purpose: WhatsAppCtaPurpose, url: string, override?: { label?: string; id?: string }): WhatsAppCtaLink {
  return {
    id: override?.id,
    label: override?.label ?? CTA_LABELS[purpose],
    url,
    purpose,
  }
}

// ─── Customer copy constants ─────────────────────────────────────────────────
// Use these instead of hard-coded literals so that copy can be tweaked
// centrally and lint tests can detect drift.

export const WHATSAPP_COPY = {
  // Continuation / confirmation prompts (customer-centred, never "Shall I…")
  confirmContinue: 'Should we continue?',
  confirmContinueShort: 'Continue?',
  confirmSubmitApplication: 'Ready to submit your application?',
  confirmSubmitRequest: 'Ready to submit this request?',
  confirmSubmit: 'Ready to submit?',

  // Common buttons
  continueButton: '✅ Continue',
  changeSkillsButton: '✏️ Change skills',
  addFileButton: '📎 Add another file',
  submitButton: '✅ Submit',
  editButton: '✏️ Edit',
  cancelButton: '❌ Cancel',
  checkStatusButton: 'Check Status',
  mainMenuButton: 'Main Menu',

  // Terms / credits
  termsCtaPrompt: 'Provider terms and credit rules are available below.',
  termsCtaShortBody: 'Provider terms and credit rules.',
} as const

// ─── Raw-URL guard ───────────────────────────────────────────────────────────
// Detects raw URLs leaking into customer-facing message bodies. Use this in:
//   * the central send pipeline (assertNoRawUrlsInWhatsAppBody before send)
//   * unit tests over fixed copy (to fail builds early)
// URLs are still allowed in CTA button payload fields — those are NOT message
// bodies; they're separate Cloud-API parameters.

const RAW_URL_PATTERNS: ReadonlyArray<RegExp> = [
  /https?:\/\//i,
  /\bwww\./i,
  /app\.plugapro\.co\.za/i,
]

export function bodyContainsRawUrl(body: string): false | { match: string; pattern: string } {
  for (const pattern of RAW_URL_PATTERNS) {
    const match = body.match(pattern)
    if (match) {
      return { match: match[0], pattern: pattern.source }
    }
  }
  return false
}

export function assertNoRawUrlsInWhatsAppBody(body: string, context?: string): void {
  const found = bodyContainsRawUrl(body)
  if (found) {
    const where = context ? ` (in ${context})` : ''
    const message =
      `WhatsApp body contains a raw URL${where}. URLs must travel via sendCtaUrl ` +
      `or template URL button components, never inline. Matched "${found.match}" against /${found.pattern}/.\n` +
      `Body preview: ${body.slice(0, 240).replace(/\n/g, ' ⏎ ')}…`
    if (process.env.NODE_ENV === 'production') {
      console.error('[whatsapp-copy] raw URL detected in WhatsApp body — refusing to send', {
        context: context ?? null,
        match: found.match,
        bodyPreview: body.slice(0, 200),
      })
    }
    throw new Error(message)
  }
}

// ─── App-centred copy guard ──────────────────────────────────────────────────
// Detects bot-self-centred phrasing. Used by the lint test, not a hard
// runtime guard, because some surfaces (admin tooling, legacy diagnostics)
// might legitimately use "I" — only customer-facing copy is in scope.

const APP_CENTRED_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bShall I\b/, reason: 'Use "Should we" instead.' },
  { pattern: /\bWould you like me to\b/i, reason: 'Use "Would you like to" or "Ready to".' },
  { pattern: /\bDo you want me to\b/i, reason: 'Use "Do you want to" or "Ready to".' },
]

export function bodyContainsAppCentredPhrase(body: string): false | { match: string; reason: string } {
  for (const entry of APP_CENTRED_PATTERNS) {
    const match = body.match(entry.pattern)
    if (match) {
      return { match: match[0], reason: entry.reason }
    }
  }
  return false
}
