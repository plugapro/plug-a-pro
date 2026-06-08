import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  resolveVerificationCompletionAction,
  type CompletionAction,
} from '@/lib/identity-verification/completion-action'

// Mirror of the page's <CompletionCtaButtons /> + <TerminalHandoff /> render
// shape (kept in lock-step with field-service/app/provider/verify/[token]/page.tsx).
// We don't import the page itself - it pulls in Prisma, server actions and the
// flags module. Rendering the same JSX shape here lets us capture the rendered
// HTML for each (channel, flag-state) combination as a static-markup snapshot
// without touching the database or booting the dev server.

const WA = 'https://wa.me/27693552447'

function CompletionCta({ action }: { action: CompletionAction }) {
  return (
    <>
      <a
        href={action.primary.href}
        data-external={action.primary.external}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {action.primary.label}
      </a>
      <a
        href={action.secondary.href}
        data-external={action.secondary.external}
        className="block text-center text-sm font-medium underline underline-offset-4"
      >
        {action.secondary.label}
      </a>
    </>
  )
}

function TerminalHandoffPreview({
  status,
  channel,
  channelAware,
}: {
  status: 'NEEDS_MANUAL_REVIEW' | 'PASSED' | 'FAILED'
  channel: 'PWA' | 'WHATSAPP' | 'ADMIN' | 'VENDOR' | null
  channelAware: boolean
}) {
  const title =
    status === 'PASSED'
      ? 'Verification complete'
      : status === 'FAILED'
        ? 'Verification could not be approved'
        : 'Submitted for manual review'
  const copy =
    status === 'PASSED'
      ? 'Your identity verification is complete.'
      : status === 'FAILED'
        ? 'Please contact Plug A Pro support for the next step.'
        : 'We will update you once the review is complete.'

  if (!channelAware) {
    return (
      <section>
        <h2>{title}</h2>
        <p>{copy}</p>
        <p>Plug A Pro will message you in WhatsApp when there&apos;s an update. You can close this page.</p>
        <a href={WA} data-external="true">Back to WhatsApp</a>
        <a href="/provider/verification">Verification help</a>
      </section>
    )
  }
  const action = resolveVerificationCompletionAction({ channel, whatsappDeeplink: WA })
  return (
    <section>
      <h2>{title}</h2>
      <p>{copy}</p>
      <p>{action.followUpCopy}</p>
      <CompletionCta action={action} />
    </section>
  )
}

describe('TerminalHandoff render snapshots (legacy + flag-on, per channel)', () => {
  it('legacy (flag OFF) renders Back to WhatsApp for every channel', () => {
    const html = renderToStaticMarkup(
      <TerminalHandoffPreview status="NEEDS_MANUAL_REVIEW" channel="PWA" channelAware={false} />,
    )
    expect(html).toContain('Submitted for manual review')
    expect(html).toContain('Back to WhatsApp')
    expect(html).toContain('href="https://wa.me/27693552447"')
    expect(html).toContain('message you in WhatsApp')
  })

  it('flag ON + PWA channel renders the in-app CTA (Lovemore-class fix)', () => {
    const html = renderToStaticMarkup(
      <TerminalHandoffPreview status="NEEDS_MANUAL_REVIEW" channel="PWA" channelAware={true} />,
    )
    expect(html).toContain('Submitted for manual review')
    expect(html).toContain('Back to Plug A Pro')
    expect(html).toContain('href="/provider"')
    expect(html).not.toContain('Back to WhatsApp')
    expect(html).not.toContain('https://wa.me')
    expect(html).not.toContain('message you in WhatsApp')
  })

  it('flag ON + WHATSAPP channel preserves the WhatsApp CTA', () => {
    const html = renderToStaticMarkup(
      <TerminalHandoffPreview status="NEEDS_MANUAL_REVIEW" channel="WHATSAPP" channelAware={true} />,
    )
    expect(html).toContain('Submitted for manual review')
    expect(html).toContain('Back to WhatsApp')
    expect(html).toContain('href="https://wa.me/27693552447"')
    expect(html).toContain('message you in WhatsApp')
  })

  it('flag ON + ADMIN channel routes to the PWA in-app CTA', () => {
    const html = renderToStaticMarkup(
      <TerminalHandoffPreview status="NEEDS_MANUAL_REVIEW" channel="ADMIN" channelAware={true} />,
    )
    expect(html).toContain('Back to Plug A Pro')
    expect(html).toContain('href="/provider"')
    expect(html).not.toContain('Back to WhatsApp')
  })

  it('flag ON + null channel uses the neutral PWA fallback + WhatsApp support secondary', () => {
    const html = renderToStaticMarkup(
      <TerminalHandoffPreview status="NEEDS_MANUAL_REVIEW" channel={null} channelAware={true} />,
    )
    expect(html).toContain('Back to Plug A Pro')
    expect(html).toContain('href="/provider"')
    expect(html).toContain('Open WhatsApp support')
    expect(html).toContain('href="https://wa.me/27693552447"')
  })
})
