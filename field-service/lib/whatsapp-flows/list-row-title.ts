// WhatsApp list rows allow 24 characters per title. The curated location
// labels ("Cape Town CBD & Atlantic Seaboard", "Gqeberha / Nelson Mandela Bay")
// are longer, and a blind slice(0, 24) produces titles that end mid-word or on
// a dangling " /" / " &". Cut on a word boundary instead and mark the cut.
//
// Shared by the customer request flow (job-request.ts) and the provider
// registration flow (registration.ts).

const ELLIPSIS = '…' // one code point
const DANGLING_CONNECTOR = /\s*[\/&\-–—,:;]+$/

// Works on code points, not UTF-16 units, so a hard cut never splits a
// surrogate pair (emoji in an admin-entered label).
export function listRowTitle(label: string, max = 24): string {
  const chars = [...label]
  if (chars.length <= max) return label
  // No room for a word plus the ellipsis: hard cut, never longer than max.
  if (max < 2) return chars.slice(0, Math.max(0, max)).join('')

  const budget = max - 1
  const head = chars.slice(0, budget)

  // A word that ends exactly at the budget is kept whole; otherwise cut at the
  // last space inside the budget.
  const wordEndsAtBudget = /\s/.test(chars[budget])
  const lastSpace = head.lastIndexOf(' ')
  let kept = (wordEndsAtBudget || lastSpace <= 0 ? head : head.slice(0, lastSpace)).join('')

  kept = kept.replace(DANGLING_CONNECTOR, '').trimEnd()
  if (kept.length === 0) kept = head.join('').trimEnd()

  return `${kept}${ELLIPSIS}`
}
