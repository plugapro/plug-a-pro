import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('signed provider lead page copy', () => {
  const source = readFileSync(join(process.cwd(), 'app/leads/access/[token]/page.tsx'), 'utf8')
  const authenticatedSource = readFileSync(join(process.cwd(), 'app/(provider)/provider/leads/[leadId]/page.tsx'), 'utf8')

  it('does not expose the old unlock-only or inspection-first actions', () => {
    expect(source).not.toContain('Unlock to view details first')
    expect(source).not.toContain('Use 1 Credit & Inspect First')
    expect(source).not.toContain('unlockLeadWithToken')
    expect(source).not.toContain('request an inspection')
    expect(authenticatedSource).not.toContain('Unlock lead for 1 Plug-A-Pro Credit')
    expect(authenticatedSource).not.toContain('Top Up to Unlock')
    expect(authenticatedSource).not.toContain('Inspection first')
  })

  it('uses the accept-or-decline journey with confirmation and protected details', () => {
    expect(source).toContain('Accept lead — uses')
    expect(source).toContain('Confirm lead acceptance')
    expect(source).toContain('Full customer details will be released only after acceptance succeeds.')
    expect(source).toContain('hasAcceptedDetails && customer')
  })

  it('only renders offer countdown and response actions for active lead offers', () => {
    expect(source).toContain("const isExpired = lead.status === 'EXPIRED'")
    expect(source).toContain("const isOpenOffer = lead.status === 'SENT' || lead.status === 'VIEWED'")
    expect(source).toContain('const canRespondToLead = isOpenOffer && !isExpired')
    expect(source).toContain('const showExpiryCountdown = Boolean(lead.expiresAt && canRespondToLead)')
    expect(source).toContain('{showExpiryCountdown && lead.expiresAt && (')
    expect(source).not.toContain('{lead.expiresAt && !isAccepted && (')
    expect(source).toContain('canRespondToLead && confirmingAccept && hasEnoughCredits')
  })
})
