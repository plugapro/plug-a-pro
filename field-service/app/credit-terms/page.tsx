import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import { buildMetadata } from '@/lib/metadata'
import { WA_ENABLED } from '@/lib/whatsapp-client'
import { PROVIDER_CREDIT_PRICE_ZAR } from '@/lib/provider-wallet'

export const metadata = buildMetadata({
  title: 'Provider Credits - Terms & Rules',
  description: 'How provider credits, top-ups, lead acceptance and billing work on Plug A Pro.',
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
    body: `Provider credits are prepaid platform units used by approved independent service providers to accept customer-selected opportunities on Plug A Pro. 1 provider credit currently equals R${PROVIDER_CREDIT_PRICE_ZAR}. Provider credits are not customer credits, cash, legal tender, loans, bank deposits or financial credit.`,
  },
  {
    heading: 'Who can buy or receive credits',
    body: 'Provider credits are for approved providers only. Paid top-ups may require identity verification and an active provider wallet. Plug A Pro may also award starter, promotional, onboarding, voucher or goodwill credits. Promo and voucher credits are separate from purchased credits and cannot be withdrawn as cash.',
  },
  {
    heading: 'When a credit is deducted',
    body: 'One provider credit is deducted only when a customer selects you and you complete final acceptance of that customer-selected opportunity through WhatsApp, the PWA or the Worker Portal. Full customer contact details, exact address and access notes unlock only after final acceptance succeeds.',
  },
  {
    heading: 'When credits are not deducted',
    body: 'Previewing a lead, showing interest, being shortlisted, customer selection before your final acceptance, declining, expiry, failed acceptance, insufficient balance or failed payment top-up does not use provider credits.',
  },
  {
    heading: 'Insufficient credits',
    body: 'If your balance is too low, you cannot complete final acceptance of paid matched leads until you top up or receive additional credits. You may still see allowed preview information, but full customer details remain hidden.',
  },
  {
    heading: 'Top-ups',
    body: 'Credits can be purchased through the top-up methods shown in the Worker Portal. Purchased credits are added only after payment is confirmed by Plug A Pro, the payment processor or manual finance reconciliation. Failed, cancelled or reversed payments do not add credits.',
  },
  {
    heading: 'Refunds and disputes',
    body: 'Purchased provider credits are generally non-refundable once bought, except where required by law or where Plug A Pro approves a reversal because of a clear platform or system error, duplicate payment, failed credit allocation, incorrect deduction, suspected fraud or chargeback reversal or another admin-approved exception. Lead-credit disputes may be approved for invalid customer number, duplicate lead, wrong category, wrong location, customer did not request, cancellation before unlock or platform error.',
  },
  {
    heading: 'Expiry',
    body: 'Purchased provider credits do not currently expire in the implemented wallet. Any future purchased-credit expiry rule requires notice and legal review. Promotional, starter, onboarding or voucher credits may expire if a lawful expiry rule is stated when they are awarded.',
  },
  {
    heading: 'Audit records',
    body: 'Plug A Pro records credit purchases, allocations, deductions, reversals, payment reversals, lead unlocks, disputes and admin adjustments in wallet ledger and audit records.',
  },
  {
    heading: 'Misuse and policy changes',
    body: 'Plug A Pro may reverse credits, suspend wallet access or block lead access where there is fraud, abuse, false information, bypassing or behaviour that harms customers, providers or the marketplace. Policy changes are communicated with notice, subject to applicable law.',
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
            Provider credits - terms &amp; rules
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--ink-mute)] leading-relaxed">
            Plain-language rules for provider prepaid credits, top-ups, lead acceptance and credits use.
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
            <strong style={{ color: 'var(--ink)' }}>29 May 2026</strong>. Provider credits are non-transferable and cannot be exchanged for cash.
          </p>
        </div>

        {/* Sections - one card with dividers */}
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
