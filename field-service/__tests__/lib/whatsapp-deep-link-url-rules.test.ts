import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('WhatsApp deep-link URL safety rules', () => {
  const whatsappBotSource = readFileSync(
    join(process.cwd(), 'lib/whatsapp-bot.ts'),
    'utf8',
  )
  const quoteDecisionSource = readFileSync(
    join(process.cwd(), 'app/api/quotes/[token]/route.ts'),
    'utf8',
  )
  const acceptedJobSource = readFileSync(
    join(process.cwd(), 'lib/accepted-job-actions.ts'),
    'utf8',
  )

  it('does not send login-gated provider job CTAs from WhatsApp handlers', () => {
    expect(whatsappBotSource).not.toContain("getPublicAppUrl(`/provider/jobs/${jobId}`)")
    expect(whatsappBotSource).not.toContain("getPublicAppUrl('/technician')")
    expect(quoteDecisionSource).not.toContain('jobUrl ?? `${appUrl}/provider`')
  })

  it('uses signed provider job-link helpers for quote-approved provider notifications', () => {
    expect(whatsappBotSource).toContain('getProviderSignedJobHandoverUrlForJobRequest')
    expect(quoteDecisionSource).toContain('getProviderSignedJobHandoverUrlForJobRequest')
  })

  it('logs quote deep-link validation with token hashes only', () => {
    expect(quoteDecisionSource).toContain('token_hash')
    expect(quoteDecisionSource).toContain('hashQuoteToken')
    expect(quoteDecisionSource).not.toContain('token=')
  })

  it('uses signed review links for post-completion customer review CTAs', () => {
    expect(acceptedJobSource).toContain('createReviewUrl')
    expect(acceptedJobSource).not.toContain('/bookings/${booking.id}/rate')
  })
})
