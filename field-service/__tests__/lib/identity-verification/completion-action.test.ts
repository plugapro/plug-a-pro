import { describe, expect, it } from 'vitest'

import { resolveVerificationCompletionAction } from '@/lib/identity-verification/completion-action'

const WA = 'https://wa.me/27693552447'

describe('resolveVerificationCompletionAction', () => {
  it('renders the WhatsApp CTA when the verification was initiated via WhatsApp', () => {
    const action = resolveVerificationCompletionAction({ channel: 'WHATSAPP', whatsappDeeplink: WA })

    expect(action.primary).toEqual({ label: 'Back to WhatsApp', href: WA, external: true })
    expect(action.secondary).toEqual({ label: 'Verification help', href: '/provider/verification', external: false })
    expect(action.followUpCopy).toMatch(/WhatsApp/)
  })

  it('renders a PWA-safe CTA when the verification was initiated from the PWA', () => {
    const action = resolveVerificationCompletionAction({ channel: 'PWA', whatsappDeeplink: WA })

    expect(action.primary).toEqual({ label: 'Back to Plug A Pro', href: '/provider', external: false })
    expect(action.secondary.href).toBe('/provider/verification')
    expect(action.followUpCopy).not.toMatch(/WhatsApp/)
  })

  it('renders the neutral PWA fallback when the channel is unknown', () => {
    const action = resolveVerificationCompletionAction({ channel: null, whatsappDeeplink: WA })

    expect(action.primary.label).toBe('Back to Plug A Pro')
    expect(action.primary.external).toBe(false)
    expect(action.primary.href).toBe('/provider')
    expect(action.followUpCopy).not.toMatch(/WhatsApp/)
  })

  it('exposes WhatsApp support as the secondary CTA only when the channel is unknown', () => {
    const action = resolveVerificationCompletionAction({ channel: null, whatsappDeeplink: WA })

    expect(action.secondary).toEqual({ label: 'Open WhatsApp support', href: WA, external: true })
  })

  it('falls back to verification help if the WhatsApp deeplink is unsafe for the unknown channel', () => {
    const action = resolveVerificationCompletionAction({
      channel: undefined,
      whatsappDeeplink: 'https://evil.example.com/foo',
    })

    expect(action.secondary).toEqual({ label: 'Verification help', href: '/provider/verification', external: false })
  })

  it('renders the neutral fallback for admin-issued links', () => {
    const action = resolveVerificationCompletionAction({ channel: 'ADMIN', whatsappDeeplink: WA })

    expect(action.primary.label).toBe('Back to Plug A Pro')
    expect(action.primary.href).toBe('/provider')
  })

  it('renders the neutral fallback for vendor-issued links', () => {
    const action = resolveVerificationCompletionAction({ channel: 'VENDOR', whatsappDeeplink: WA })

    expect(action.primary.label).toBe('Back to Plug A Pro')
    expect(action.primary.href).toBe('/provider')
  })

  it('never defaults to WhatsApp when the channel is missing', () => {
    const action = resolveVerificationCompletionAction({ channel: undefined, whatsappDeeplink: WA })

    expect(action.primary.label).not.toBe('Back to WhatsApp')
    expect(action.primary.external).toBe(false)
  })

  it('rejects non-internal dashboardHref and falls back to /provider', () => {
    const action = resolveVerificationCompletionAction({
      channel: 'PWA',
      whatsappDeeplink: WA,
      dashboardHref: 'https://evil.example.com/admin',
    })

    expect(action.primary.href).toBe('/provider')
    expect(action.primary.external).toBe(false)
  })

  it('rejects protocol-relative dashboardHref', () => {
    const action = resolveVerificationCompletionAction({
      channel: 'PWA',
      whatsappDeeplink: WA,
      dashboardHref: '//evil.example.com',
    })

    expect(action.primary.href).toBe('/provider')
  })

  it('rejects javascript: dashboardHref', () => {
    const action = resolveVerificationCompletionAction({
      channel: 'PWA',
      whatsappDeeplink: WA,
      dashboardHref: 'javascript:alert(1)',
    })

    expect(action.primary.href).toBe('/provider')
  })

  it('rejects a non-WhatsApp deeplink and falls back to the PWA CTA for WHATSAPP channel', () => {
    const action = resolveVerificationCompletionAction({
      channel: 'WHATSAPP',
      whatsappDeeplink: 'https://evil.example.com/foo',
    })

    expect(action.primary.label).toBe('Back to Plug A Pro')
    expect(action.primary.external).toBe(false)
    expect(action.primary.href).toBe('/provider')
  })

  it('honours api.whatsapp.com deeplinks as well as wa.me', () => {
    const apiLink = 'https://api.whatsapp.com/send?phone=27693552447'
    const action = resolveVerificationCompletionAction({ channel: 'WHATSAPP', whatsappDeeplink: apiLink })

    expect(action.primary.href).toBe(apiLink)
    expect(action.primary.external).toBe(true)
  })

  it('honours custom internal dashboardHref overrides', () => {
    const action = resolveVerificationCompletionAction({
      channel: 'PWA',
      whatsappDeeplink: WA,
      dashboardHref: '/provider/dashboard',
    })

    expect(action.primary.href).toBe('/provider/dashboard')
  })
})
