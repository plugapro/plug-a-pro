import Link from 'next/link'
import { WhatsAppLink } from '@/components/shared/WhatsAppLink'

const WA_NUMBER = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')
const WA_HREF = WA_NUMBER
  ? `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi, I found a broken link on Plug A Pro')}`
  : `mailto:support@plugapro.co.za?subject=${encodeURIComponent('Broken link report')}`
const IS_WHATSAPP_HREF = WA_HREF.startsWith('https://wa.me/')

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center overflow-hidden">
      {/* Radial halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] rounded-full opacity-20"
        style={{ background: 'var(--brand-purple)', filter: 'blur(80px)' }}
      />

      {/* Layered icon */}
      <div className="relative mb-8">
        {/* Outer gradient-soft tile 88×88 */}
        <div
          className="w-[88px] h-[88px] rounded-[28px] flex items-center justify-center"
          style={{ background: 'rgba(139,63,232,0.10)' }}
        >
          {/* Inner white tile 56×56 */}
          <div
            className="w-[56px] h-[56px] rounded-[18px] flex items-center justify-center"
            style={{
              background: 'var(--brand-gradient, linear-gradient(135deg, #8B3FE8, #2A78F0))',
              boxShadow: '0 8px 24px rgba(139,63,232,0.35)',
            }}
          >
            <span
              className="font-bold text-white leading-none"
              style={{ fontSize: 28 }}
              aria-hidden
            >
              ?
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-10 max-w-[320px]">
        <h1
          className="font-bold tracking-[-0.025em]"
          style={{ fontSize: 26, color: 'var(--ink)' }}
        >
          We can&apos;t find that page
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-mute)', lineHeight: 1.55 }}>
          The link may have expired, moved or never existed.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-[280px]">
        <Link
          href="/"
          className="h-[52px] rounded-[14px] flex items-center justify-center text-[15px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
        >
          Back to home
        </Link>
        {IS_WHATSAPP_HREF ? (
          <WhatsAppLink
            href={WA_HREF}
            source="not_found_report"
            ctaLabel="Report this"
            aria-label="Report this broken link"
            className="h-[52px] rounded-[14px] flex items-center justify-center text-[15px] font-semibold"
            style={{
              background: 'var(--card-alt)',
              color: 'var(--ink)',
              boxShadow: 'inset 0 0 0 1px var(--border)',
            }}
          >
            Report this
          </WhatsAppLink>
        ) : (
          <a
            href={WA_HREF}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Report this broken link"
            className="h-[52px] rounded-[14px] flex items-center justify-center text-[15px] font-semibold"
            style={{
              background: 'var(--card-alt)',
              color: 'var(--ink)',
              boxShadow: 'inset 0 0 0 1px var(--border)',
            }}
          >
            Report this
          </a>
        )}
      </div>
    </div>
  )
}
