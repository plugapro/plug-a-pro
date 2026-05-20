import Link from 'next/link'

export const LEGAL_PAGES = [
  { slug: 'privacy', title: 'Privacy policy', path: '/privacy', group: 'For everyone', blurb: 'How we collect and use your information.' },
  { slug: 'terms', title: 'Terms of service', path: '/terms', group: 'For everyone', blurb: 'The agreement between you and Plug A Pro.' },
  { slug: 'refund-policy', title: 'Refund policy', path: '/refund-policy', group: 'For everyone', blurb: 'When refunds apply and how they are processed.' },
  { slug: 'trust', title: 'Trust & safety', path: '/trust', group: 'For everyone', blurb: 'How we verify providers and handle disputes.' },
  { slug: 'provider-terms', title: 'Provider terms', path: '/provider-terms', group: 'For service providers', blurb: 'Marketplace rules for providers.' },
  { slug: 'credits-policy', title: 'Provider credits rules', path: '/credits-policy', group: 'For service providers', blurb: 'How credits are charged and refunded.' },
  { slug: 'faq', title: 'FAQ', path: '/faq', group: 'Help', blurb: 'Common customer and provider questions.' },
  { slug: 'contact', title: 'Contact support', path: '/contact', group: 'Help', blurb: 'How to reach Plug A Pro support.' },
] as const

export function LegalHubScreen() {
  const groups = LEGAL_PAGES.reduce<Record<string, Array<(typeof LEGAL_PAGES)[number]>>>((acc, page) => {
    const existing = acc[page.group] ?? []
    acc[page.group] = [...existing, page]
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Legal & policies</h1>
      <p className="mt-2 rounded-2xl bg-[var(--tone-brand-bg)] p-3 text-sm text-[var(--ink-mute)]">
        Canonical source: plugapro.co.za
      </p>
      {Object.entries(groups).map(([group, pages]) => (
        <section key={group} className="mt-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-mute)]">{group}</p>
          <div className="mt-2 rounded-2xl border border-border bg-card">
            {pages.map((page) => (
              <Link key={page.slug} href={`/client/legal/${page.slug}`} className="block border-b border-border px-4 py-3 last:border-b-0">
                <p className="text-sm font-semibold">{page.title}</p>
                <p className="text-xs text-[var(--ink-mute)]">plugapro.co.za{page.path}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function LegalPageScreen({
  title,
  blurb,
  path,
}: {
  title: string
  blurb: string
  path: string
}) {
  const fullUrl = `https://plugapro.co.za${path}`
  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-[var(--ink-mute)]">{blurb}</p>
      <p className="mt-3 inline-flex rounded-full bg-[var(--tone-brand-bg)] px-3 py-1 font-mono text-xs text-[var(--tone-brand-fg)]">
        plugapro.co.za{path}
      </p>
      <iframe
        src={fullUrl}
        title={title}
        className="mt-4 h-[60vh] w-full rounded-2xl border border-border bg-card"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-[rgba(246,246,248,0.92)] px-5 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-xl dark:bg-[rgba(11,11,16,0.92)]">
        <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="mx-auto block w-full max-w-md rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}>
          Open on plugapro.co.za
        </a>
      </div>
    </div>
  )
}
