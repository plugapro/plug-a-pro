// Provider landing page - entry point from homepage provider strip
import Link from 'next/link'
import {
  Wrench, ShieldCheck, Zap, MapPin, Bell, Star, ArrowRight, CheckCircle2,
} from 'lucide-react'
import { buildMetadata } from '@/lib/metadata'
import { AppLogo } from '@/components/shared/app-logo'
import { Wordmark } from '@/components/shared/wordmark'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({
  title: 'Join as a Service Provider',
  description: 'Receive real job leads in your area. Apply once, get matched daily. Transparent fees, end-to-end tracking.',
})

const HOW_IT_WORKS = [
  { icon: <Wrench size={18} />, title: 'Apply once', desc: 'Tell us your skills, service areas and experience. Approval usually takes under 24 hours.' },
  { icon: <Bell size={18} />, title: 'Receive leads', desc: 'We notify you on WhatsApp when a matching job is available. Accept or pass - no pressure.' },
  { icon: <Zap size={18} />, title: 'Quote & win work', desc: 'Contact the customer, do the inspection if needed and submit a written quote through the platform.' },
  { icon: <CheckCircle2 size={18} />, title: 'Get paid', desc: 'Complete the job, collect payment and build your rating. Repeat.' },
]

const BENEFITS = [
  { icon: <ShieldCheck size={16} />, text: 'Real, paying customers - no tyre-kickers' },
  { icon: <MapPin size={16} />, text: 'Leads matched to your service area' },
  { icon: <Star size={16} />, text: 'Build a rated profile that wins repeat work' },
  { icon: <Zap size={16} />, text: 'Transparent credit system - no hidden subscription' },
]

export default function ProviderLandingPage() {
  return (
    <div className="relative min-h-screen screen-enter">
      {/* Gradient halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 right-0 h-72"
        style={{ background: 'radial-gradient(70% 100% at 50% -20%, rgba(139,63,232,0.15), transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-center gap-2.5 px-[18px] pt-[60px] pb-1.5">
        <AppLogo href="/" compact className="h-8" priority />
        <Wordmark size={13} />
      </div>

      {/* Hero */}
      <div className="relative px-[18px] pt-6 pb-4">
        <div
          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full brand-gradient-soft text-[var(--brand-purple)] text-[11.5px] font-bold tracking-[0.02em] mb-3"
        >
          <Wrench size={13} />
          For service providers
        </div>
        <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--ink)] [text-wrap:balance] mb-3">
          Win paying work - without the noise.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--ink-mute)] [text-wrap:pretty] max-w-[340px] mb-6">
          Real leads in your area, sent to your WhatsApp. Transparent fees, written quotes, end-to-end tracking.
        </p>
        <div className="flex flex-col gap-2.5">
          <Button asChild size="lg" className="w-full">
            <Link href="/provider-sign-in">
              Join as a provider
              <ArrowRight size={16} />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link href="/sign-in">I&apos;m a customer</Link>
          </Button>
        </div>
      </div>

      {/* Benefits strip */}
      <div className="px-[18px] pt-4 pb-1">
        <div
          className="rounded-[20px] divide-y divide-[var(--border)]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          {BENEFITS.map(({ icon, text }) => (
            <div key={text} className="flex items-center gap-3 px-4 py-3.5">
              <span style={{ color: 'var(--brand-purple)' }} aria-hidden>{icon}</span>
              <span className="text-[13.5px] font-medium leading-snug" style={{ color: 'var(--ink)' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="px-[18px] pt-5 pb-1">
        <p
          className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
          style={{ color: 'var(--ink-mute)' }}
        >
          How it works
        </p>
        <div
          className="rounded-[20px] divide-y divide-[var(--border)]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          {HOW_IT_WORKS.map(({ icon, title, desc }, i) => (
            <div key={title} className="flex items-start gap-3 px-4 py-[14px]">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0 brand-gradient-soft"
                style={{ color: 'var(--brand-purple)' }}
                aria-hidden
              >
                {icon}
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-bold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
                  {i + 1}. {title}
                </p>
                <p className="text-[12.5px] mt-0.5 leading-[1.4]" style={{ color: 'var(--ink-mute)' }}>
                  {desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="px-[18px] pt-6 pb-10">
        <Button asChild size="lg" className="w-full">
          <Link href="/provider-sign-in">
            Apply now - it&apos;s free
            <ArrowRight size={16} />
          </Link>
        </Button>
        <p className="mt-3 text-center text-[12px]" style={{ color: 'var(--ink-soft)' }}>
          Approval usually takes under 24 hours.
        </p>
      </div>
    </div>
  )
}
