// WhatsApp list rows allow 24 characters per title. The curated location
// labels ("Cape Town CBD & Atlantic Seaboard", "Gqeberha / Nelson Mandela Bay")
// are longer, and a blind slice(0, 24) produces titles that end mid-word or on
// a dangling " /" / " &". Cut on a word boundary instead and mark the cut.
//
// Shared by the customer request flow (job-request.ts) and the provider
// registration flow (registration.ts).

const ELLIPSIS = '…' // one UTF-16 code unit
const DANGLING_CONNECTOR = /\s*[\/&\-–—,:;]+$/

export function listRowTitle(label: string, max = 24): string {
  if (label.length <= max) return label

  const budget = Math.max(1, max - ELLIPSIS.length)
  const head = label.slice(0, budget)
  const lastSpace = head.lastIndexOf(' ')

  let kept = lastSpace > 0 ? head.slice(0, lastSpace) : head
  kept = kept.replace(DANGLING_CONNECTOR, '').trimEnd()
  if (kept.length === 0) kept = head.trimEnd()

  return `${kept}${ELLIPSIS}`
}
