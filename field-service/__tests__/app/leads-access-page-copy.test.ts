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
    expect(authenticatedSource).not.toContain('Unlock lead for 1 Plug A Pro provider credit')
    expect(authenticatedSource).not.toContain('Top Up to Unlock')
    expect(authenticatedSource).not.toContain('Inspection first')
  })

  it('uses the accept-or-decline journey with confirmation and protected details', () => {
    expect(source).toContain('Accept job')
    expect(source).toContain('Confirm lead acceptance')
    expect(source).toContain('Full customer details are released only after credit is applied and the job is assigned.')
    expect(source).toContain('hasAcceptedDetails && customer')
  })

  it('only renders offer countdown and response actions for active lead offers', () => {
    expect(source).toContain("const isExpired = lead.status === 'EXPIRED'")
    expect(source).toContain("const isOpenOffer = lead.status === 'SENT' || lead.status === 'VIEWED' || lead.status === 'CUSTOMER_SELECTED'")
    expect(source).toContain('const canRespondToLead = isOpenOffer && !isExpired')
    expect(source).toContain('const showExpiryCountdown = Boolean(lead.expiresAt && canRespondToLead)')
    expect(source).toContain('{showExpiryCountdown && lead.expiresAt && (')
    expect(source).not.toContain('{lead.expiresAt && !isAccepted && (')
    expect(source).toContain('canRespondToLead && confirmingAccept')
  })

  it('lead detail page no longer renders expiry countdown once a lead is accepted', () => {
    expect(authenticatedSource).toContain('const isAcceptedLead =')
    expect(authenticatedSource).toContain("lead.status === 'PROVIDER_ACCEPTED'")
    expect(authenticatedSource).toContain("lead.status === 'CREDIT_REQUIRED'")
    expect(authenticatedSource).toContain("lead.status === 'CREDIT_APPLIED'")
    expect(authenticatedSource).toContain('lead.expiresAt && !isAcceptedLead && (')
  })

  it('renders arrival scheduling as a completed step after an arrival time is saved', () => {
    expect(source).toContain('const hasPlannedArrival = isAccepted && Boolean(jr.match?.plannedArrivalStart)')
    expect(source).toContain('const arrivalActionsDone = Boolean(')
    expect(source).toContain("const showArrivalForm = !hasPlannedArrival || resolvedSearchParams.editArrival === '1'")
    expect(source).toContain('{isAccepted && hasPlannedArrival && !showArrivalForm && !arrivalActionsDone && (')
    expect(source).toContain('Arrival time confirmed')
    expect(source).toContain('Customer has been notified on WhatsApp.')
    expect(source).toContain('Change arrival time')
    expect(source).toContain('{isAccepted && showArrivalForm && !arrivalActionsDone && (')
  })

  it('defaults the change-arrival form to the persisted arrival window', () => {
    expect(source).toContain('function getArrivalFormDefaults')
    expect(source).toContain('if (!params.plannedArrivalStart) return params.fallback')
    expect(source).toContain('plannedArrivalStart: jr.match?.plannedArrivalStart')
    expect(source).toContain('plannedArrivalEnd: jr.match?.plannedArrivalEnd')
    expect(source).toContain('fallback: deriveDefaultArrivalWindow(customerAvailability)')
  })
})
