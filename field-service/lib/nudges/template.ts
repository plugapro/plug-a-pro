// ─── West Rand pilot provider nudge template ────────────────────────────────
// Pure render. No Meta API call in v1 — the rendered string is used for the
// admin preview and CSV export only. When live send lands in a future PR,
// the wording moves to lib/messaging-templates.ts and gets registered with
// Meta; this helper stays for in-app preview.

export function buildMissingItemsLabel(items: string[]): string {
  if (items.length === 0) return 'a few details'
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  const head = items.slice(0, -1).join(', ')
  const tail = items[items.length - 1]
  return `${head}, and ${tail}`
}

export function renderNudgeMessage(params: {
  firstName: string | null | undefined
  missingItemsLabel: string
}): string {
  const name = params.firstName?.trim() || 'there'
  return (
    `Hi ${name}, thanks again for registering with Plug A Pro. We are preparing the first West Rand pilot jobs and noticed your profile is missing: ${params.missingItemsLabel}.\n` +
    'We have noticed that providers with a more complete profile are easier for customers to trust and nominate for jobs. Please add these when you have a moment so you can be considered for more suitable leads.'
  )
}
