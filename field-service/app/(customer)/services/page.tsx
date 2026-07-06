// ─── Customer: Request a service - category picker ────────────────────────────

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Droplets, Hammer, Paintbrush, Sparkles, Wrench,
  Layers, Scissors, ArrowRight,
} from 'lucide-react'
import { getSession } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { SectionLabel } from '@/components/ui/section-label'

export const metadata = buildMetadata({ title: 'Request a Service' })

const CATEGORIES = [
  { slug: 'plumbing',  name: 'Plumbing',           desc: 'Leaks, pipes, taps, drains',       icon: Droplets,   hue: '#2A78F0' },
  { slug: 'handyman',  name: 'Handyman',            desc: 'General repairs and maintenance',   icon: Hammer,     hue: '#8B3FE8' },
  { slug: 'carpentry', name: 'Carpentry',           desc: 'Furniture, doors, shelving',        icon: Wrench,     hue: '#C8854D' },
  { slug: 'tiling',    name: 'Tiling',              desc: 'Floor and wall tiling, grouting',   icon: Layers,     hue: '#E5484D' },
  { slug: 'painting',  name: 'Painting',            desc: 'Interior and exterior painting',    icon: Paintbrush, hue: '#FF1F8E' },
  { slug: 'cleaning',  name: 'Cleaning',            desc: 'Domestic and commercial cleaning',  icon: Sparkles,   hue: '#0FA28A' },
  { slug: 'garden',    name: 'Garden & Landscaping', desc: 'Lawn care, trimming, landscaping', icon: Scissors,   hue: '#2D9C5D' },
  { slug: 'diy',       name: 'DIY & Assembly',      desc: 'Flat-pack, shelving, mounting',     icon: Hammer,     hue: '#7C4DFF' },
] as const

export default async function ServicesPage() {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/services')}`)

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5">
        <h1 className="text-[30px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
          Request a service
        </h1>
        <p className="mt-2 text-[14.5px] text-[var(--ink-mute)] leading-relaxed">
          Pick a category and describe your job. We&apos;ll match you with independent local providers.
        </p>
      </div>

      <div className="px-[18px]">
        <SectionLabel className="mb-3">What do you need help with?</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            return (
              <Link
                key={`${cat.slug}-${cat.name}`}
                href={`/book/${cat.slug}`}
                className="flex items-center gap-3 bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-4 transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)] active:translate-y-px active:scale-[0.98]"
              >
                <div
                  className="flex items-center justify-center w-10 h-10 rounded-[12px] shrink-0"
                  style={{ background: `${cat.hue}15`, color: cat.hue }}
                >
                  <Icon size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-[var(--ink)] tracking-[-0.01em] leading-tight">
                    {cat.name}
                  </p>
                  <p className="text-[12px] text-[var(--ink-mute)] mt-0.5 leading-tight line-clamp-2">
                    {cat.desc}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>

        <div className="mt-6 bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-[12px] bg-[rgba(139,63,232,0.08)] text-[var(--brand-purple)] shrink-0">
            <ArrowRight size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-[var(--ink)] tracking-[-0.01em]">Something else?</p>
            <p className="text-[12px] text-[var(--ink-mute)] mt-0.5">Browse all providers and find who you need</p>
          </div>
          <Link
            href="/providers"
            className="h-8 px-3 rounded-[10px] bg-[var(--ink)] text-[var(--card)] text-[12.5px] font-semibold flex items-center shrink-0"
          >
            Browse
          </Link>
        </div>
      </div>
    </div>
  )
}
