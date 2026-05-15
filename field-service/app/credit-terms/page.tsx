import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import { buildMetadata } from '@/lib/metadata'
import { WA_ENABLED } from '@/lib/whatsapp-client'

export const metadata = buildMetadata({
  title: 'Provider Credits — Terms & Rules',
  description: 'How provider credits, top-ups, lead acceptance, and billing work on Plug A Pro.',
  path: '/credit-terms',
})

function WhatsAppIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      width={16} height={16} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

const SECTIONS = [
  {
    heading: 'What are provider credits?',
    body: 'Credits are prepaid units used by service providers to accept job leads on Plug A Pro. One credit is deducted each time you formally accept a customer-selected lead and confirm the booking. Credits are not refundable once consumed.',
  },
  {
    heading: 'Onboarding credits',
    body: 'New providers approved during qualifying periods may receive promotional credits. These are awarded to your wallet on approval and valid for 90 days. Promotional credits expire and are forfeited if unused. They cannot be transferred or exchanged for cash.',
  },
  {
    heading: 'Accepting a job',
    body: 'When a customer selects you from a shortlist and you confirm, 1 credit is deducted from your wallet. Declining a lead or letting it expire does not cost credits. If a customer cancels their booking within 2 hours of your acceptance, the credit is returned automatically.',
  },
  {
    heading: 'Viewing a lead',
    body: 'You can view a lead\'s category, area, and urgency without spending credits. Customer contact details and the full job address are only revealed after you accept. Declining after viewing a lead does not cost credits.',
  },
  {
    heading: 'Insufficient credits',
    body: 'If your balance is zero, you cannot accept new leads until you top up. You can still view the lead summary, but the full customer details remain hidden. Leads expire after a set window regardless of your balance — top up before they arrive to stay competitive.',
  },
  {
    heading: 'Top-ups',
    body: 'Credits can be purchased via Pay@, PayFast, or manual EFT. Pay@ and PayFast top-ups reflect immediately. EFT top-ups are confirmed within 1–2 business days. Credits are sold in fixed bundles — partial bundles are not available.',
  },
  {
    heading: 'Refunds and disputes',
    body: 'Credits consumed for accepted jobs are non-refundable. If you believe a credit was deducted in error, contact support via WhatsApp within 14 days with your job reference number. We investigate all credit disputes and respond within 3 business days.',
  },
  {
    heading: 'Misuse and policy changes',
    body: 'Plug A Pro may reverse credits, suspend wallet access, or block lead access where there is fraud, abuse, false information, or behaviour that harms customers or other providers. Policy changes are communicated with 14 days notice — continued use after the effective date constitutes acceptance.',
  },
]

export default function CreditTermsPage() {
  const waNumber = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')
  const supportHref = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent('Hi, I have a question about my provider credits')}`
    : `mailto:support@plugapro.co.za?subject=${encodeURIComponent('Credits query')}`

  return (
    <div className="min-h-screen pb-16 screen-enter print:bg-white" style={{ background: 'var(--background)' }}>

      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-6 flex items-start gap-3">
        <Link
          href="/provider"
          aria-label="Back"
          className="mt-1 flex items-center justify-center w-9 h-9 rounded-[12px] shrink-0 print:hidden"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--ink)' }} />
        </Link>
        <div>
          <p className="text-[11px] font-bold tracking-[0.085em] uppercase text-[var(--brand-purple)] mb-1">
            Plug A Pro · Provider docs
          </p>
          <h1 className="text-[26px] font-bold tracking-[-0.025em] leading-tight text-[var(--ink)]">
            Provider credits — terms &amp; rules
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--ink-mute)] leading-relaxed">
            Plain-language rules for provider prepaid credits, top-ups, lead acceptance, and credits use.
          </p>
        </div>
      </div>

      <div className="px-[18px] space-y-4">

        {/* Intro card */}
        <div
          className="rounded-[20px] p-4 flex gap-3"
          style={{
            background: 'var(--brand-gradient-soft, rgba(139,63,232,0.07))',
            boxShadow: 'inset 0 0 0 1px rgba(139,63,232,0.14)',
          }}
        >
          <div
            className="flex items-center justify-center w-8 h-8 rounded-[10px] shrink-0 mt-0.5"
            style={{ background: 'rgba(139,63,232,0.12)', color: 'var(--brand-purple)' }}
          >
            <Info size={16} />
          </div>
          <p className="text-[13.5px] text-[var(--ink-mute)] leading-relaxed">
            These terms apply to all providers using the Plug A Pro credit wallet. Last updated{' '}
            <strong style={{ color: 'var(--ink)' }}>May 2026</strong>. Credits are non-transferable and cannot be exchanged for cash.
          </p>
        </div>

        {/* Sections — one card with dividers */}
        <div
          className="rounded-[20px] overflow-hidden"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          {SECTIONS.map((section, i) => (
            <div
              key={section.heading}
              className="px-5 py-5"
              style={i > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
            >
              <h2 className="text-[15px] font-bold tracking-[-0.02em] text-[var(--ink)] mb-2">
                {section.heading}
              </h2>
              <p className="text-[13.5px] text-[var(--ink-mute)] leading-[1.65]">
                {section.body}
              </p>
            </div>
          ))}
        </div>

        {/* Support card */}
        <div
          className="rounded-[20px] p-5 print:hidden"
          style={{
            background: 'rgba(37,211,102,0.06)',
            boxShadow: 'inset 0 0 0 1px rgba(37,211,102,0.20)',
          }}
        >
          <div className="flex gap-3 mb-4">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-[11px] shrink-0"
              style={{ background: '#25D366', color: '#fff' }}
            >
              <WhatsAppIcon />
            </div>
            <div>
              <p className="text-[14px] font-bold text-[var(--ink)] tracking-[-0.01em] mb-0.5">
                Questions about your credits?
              </p>
              <p className="text-[12.5px] text-[var(--ink-mute)] leading-snug">
                Our support team responds within 1 business day for billing queries.
              </p>
            </div>
          </div>
          {WA_ENABLED ? (
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 h-[46px] rounded-[13px] text-[14px] font-semibold text-white"
              style={{ background: '#25D366' }}
            >
              <WhatsAppIcon />
              Open WhatsApp support
            </a>
          ) : (
            <a
              href={supportHref}
              className="flex items-center justify-center h-[46px] rounded-[13px] text-[14px] font-semibold text-[var(--ink)]"
              style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              Email support
            </a>
          )}
        </div>

      </div>
    </div>
  )
}
