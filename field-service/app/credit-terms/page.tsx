import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({
  title: 'Credit & Billing Terms',
  description: 'How credits, top-ups, and billing work on Plug A Pro.',
  path: '/credit-terms',
})

const SECTIONS = [
  {
    heading: 'What are provider credits?',
    body: 'Credits are prepaid units used by service providers to accept job leads and bookings on the Plug A Pro platform. Credits are non-refundable once consumed.',
  },
  {
    heading: 'Purchasing credits',
    body: 'Credits can be topped up via Pay@, PayFast, or manual EFT. Once a payment is confirmed, credits are added to your wallet immediately (Pay@ and PayFast) or within 1–2 business days (EFT). Top-up amounts are fixed denominations — partial bundles are not available.',
  },
  {
    heading: 'How credits are deducted',
    body: 'A credit is deducted when you formally accept a lead and confirm the job. Viewing a lead or declining it does not cost credits. If a job is cancelled by the customer within 2 hours of acceptance, the credit is returned.',
  },
  {
    heading: 'Credit expiry',
    body: 'Purchased credits do not expire. Promotional credits (awarded during sign-up campaigns) expire 90 days from the date of award. Expired promotional credits are forfeited and cannot be reinstated.',
  },
  {
    heading: 'Refunds and disputes',
    body: 'Credits consumed for accepted jobs are non-refundable. If you believe a credit was deducted in error, contact support via WhatsApp within 14 days and provide your job reference number. We investigate all credit disputes and respond within 3 business days.',
  },
  {
    heading: 'Changes to this policy',
    body: 'Plug A Pro may update these terms with 14 days notice. Continued use of the platform after a change takes effect constitutes acceptance of the revised terms.',
  },
]

export default function CreditTermsPage() {
  return (
    <div className="min-h-screen pb-32 screen-enter" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-6 flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <ChevronLeft size={18} style={{ color: 'var(--ink)' }} />
        </Link>
        <div>
          <p
            className="font-bold tracking-[0.08em] uppercase mb-0.5"
            style={{ fontSize: 11, color: 'var(--brand-purple)' }}
          >
            Platform policy
          </p>
          <h1
            className="font-bold tracking-[-0.025em] leading-tight"
            style={{ fontSize: 26, color: 'var(--ink)' }}
          >
            Credit &amp; billing terms
          </h1>
        </div>
      </div>

      {/* Intro card */}
      <div className="px-[18px] mb-4">
        <div
          className="rounded-[20px] px-5 py-4"
          style={{
            background: 'rgba(139,63,232,0.06)',
            boxShadow: 'inset 0 0 0 1px rgba(139,63,232,0.15)',
          }}
        >
          <p style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
            These terms apply to all providers using the Plug A Pro credit wallet. Last updated{' '}
            <strong style={{ color: 'var(--ink)' }}>May 2026</strong>.
          </p>
        </div>
      </div>

      {/* Sections */}
      <div className="px-[18px] space-y-3">
        {SECTIONS.map((section) => (
          <div
            key={section.heading}
            className="rounded-[20px] px-5 py-5"
            style={{
              background: 'var(--card)',
              boxShadow: 'inset 0 0 0 1px var(--border)',
            }}
          >
            <h2
              className="font-bold tracking-[-0.015em] mb-2"
              style={{ fontSize: 15, color: 'var(--ink)' }}
            >
              {section.heading}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.65 }}>
              {section.body}
            </p>
          </div>
        ))}
      </div>

      {/* Support footer */}
      <div className="px-[18px] mt-6">
        <div
          className="rounded-[20px] px-5 py-5 flex flex-col gap-4"
          style={{ background: 'var(--ink)', color: 'var(--card)' }}
        >
          <div>
            <p
              className="font-bold tracking-[0.08em] uppercase mb-1 opacity-60"
              style={{ fontSize: 11 }}
            >
              Questions?
            </p>
            <p className="font-semibold" style={{ fontSize: 15 }}>
              Contact support via WhatsApp
            </p>
            <p className="opacity-70 mt-1" style={{ fontSize: 13, lineHeight: 1.5 }}>
              We respond within 1 business day for billing queries.
            </p>
          </div>
          <a
            href="https://wa.me/27000000000?text=Hi%2C+I+have+a+question+about+credits"
            target="_blank"
            rel="noopener noreferrer"
            className="h-[48px] rounded-[12px] flex items-center justify-center text-[14px] font-semibold"
            style={{ background: '#25D366', color: '#fff' }}
          >
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </div>
  )
}
