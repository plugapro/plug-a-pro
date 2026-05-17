export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { isEnabled } from '@/lib/flags'
import { ArrowLeft, Check, MapPin, Star, ExternalLink } from 'lucide-react'
import { getPilotServiceCategories } from '@/lib/service-categories'

const CATEGORY_LABELS = new Map(getPilotServiceCategories().map(o => [o.tag, o.label]))

function labelForCategory(tag: string) {
  return CATEGORY_LABELS.get(tag) ?? tag.replaceAll('_', ' ')
}

const CATEGORY_HUES: Record<string, string> = {
  plumbing:    '#2A78F0',
  electrical:  '#FFC22B',
  handyman:    '#8B3FE8',
  carpentry:   '#C8854D',
  painting:    '#FF1F8E',
  cleaning:    '#0FA28A',
  appliances:  '#5B5B66',
  gas:         '#E5484D',
  geyser:      '#E5484D',
}

function toneForCategory(slug: string): string {
  const key = Object.keys(CATEGORY_HUES).find(k => slug.toLowerCase().includes(k))
  return key ? CATEGORY_HUES[key] : '#8B3FE8'
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const provider = await db.provider.findUnique({ where: { id }, select: { name: true, bio: true } })
  if (!provider) return buildMetadata({ title: 'Provider Profile' })
  const bio = provider.bio ?? ''
  const description = bio.length > 150 ? `${bio.slice(0, 150)}...` : bio || undefined
  return buildMetadata({ title: provider.name, description })
}

export default async function CustomerProviderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  const isCustomerSignedIn = session?.role === 'customer'

  const flagEnabled = await isEnabled('feature.customer.provider_browse')
  if (!flagEnabled) redirect('/')

  const { id } = await params

  const provider = await db.provider.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      bio: true,
      experience: true,
      skills: true,
      serviceAreas: true,
      evidenceNote: true,
      portfolioUrls: true,
      verified: true,
      availableNow: true,
      averageRating: true,
      completedJobsCount: true,
      onTimeRate: true,
      providerCategories: {
        where: { approvalStatus: 'APPROVED' },
        select: { categorySlug: true, subServices: true, yearsExperience: true },
        orderBy: { categorySlug: 'asc' },
      },
      providerRates: {
        select: { categorySlug: true, callOutFee: true, hourlyRate: true, rateNegotiable: true },
        orderBy: { categorySlug: 'asc' },
      },
    },
  })

  if (!provider) notFound()

  const completedJobs = await db.job.findMany({
    where: { providerId: provider.id, status: 'COMPLETED' },
    select: {
      id: true,
      booking: {
        select: {
          match: { select: { jobRequest: { select: { category: true } } } },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
    take: 50,
  })

  const jobCategoryMap = new Map(
    completedJobs.map(j => [j.id, j.booking?.match?.jobRequest?.category ?? ''])
  )

  const reviews = await db.review.findMany({
    where: {
      reviewerType: 'CUSTOMER',
      jobId: { in: completedJobs.map(j => j.id) },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  const averageRating =
    provider.averageRating != null
      ? Number(provider.averageRating)
      : reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length
      : null

  const primaryCategorySlug =
    provider.providerCategories[0]?.categorySlug ?? provider.skills[0] ?? ''
  const tone = toneForCategory(primaryCategorySlug)
  const primaryCategoryLabel = primaryCategorySlug
    ? labelForCategory(primaryCategorySlug)
    : 'Service provider'

  const bookingUrl = `/book/${encodeURIComponent(primaryCategorySlug || 'other')}?provider=${encodeURIComponent(provider.id)}`
  const ctaHref = isCustomerSignedIn ? bookingUrl : `/sign-in?next=${encodeURIComponent(bookingUrl)}`

  const initials =
    provider.name?.split(' ').map(s => s[0]).slice(0, 2).join('') ?? 'P'

  const avatarGradient = `linear-gradient(135deg, ${tone}, #2A78F0)`

  const primaryArea = provider.serviceAreas[0] ?? null
  const mainRate = provider.providerRates[0] ?? null

  const allChips = provider.providerCategories.flatMap(c => c.subServices)
  const chips = (allChips.length > 0 ? allChips : provider.skills).slice(0, 8)

  const yearsExp =
    provider.providerCategories[0]?.yearsExperience != null
      ? `${provider.providerCategories[0].yearsExperience} yrs`
      : provider.experience
      ? provider.experience.split(/\s+/).slice(0, 2).join(' ')
      : '—'

  const onTimeLabel =
    provider.onTimeRate != null
      ? `${Math.round(Number(provider.onTimeRate) * 100)}%`
      : '—'

  return (
    <div className="pb-28 screen-enter" style={{ background: 'var(--page)' }}>

      {/* ── Hero band ────────────────────────────────────────────── */}
      <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
        {/* Gradient layer */}
        <div
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(135deg, ${tone} 0%, var(--brand-purple) 100%)`,
          }}
        />
        {/* Stripe texture overlay */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 16px)',
          }}
        />
        {/* Frosted glass nav buttons */}
        <div
          style={{
            position: 'absolute', top: 58, left: 16, right: 16,
            display: 'flex', justifyContent: 'space-between',
          }}
        >
          <Link
            href="/providers"
            style={{
              width: 38, height: 38, borderRadius: 12,
              background: 'rgba(255,255,255,0.18)', color: '#fff',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={18} />
          </Link>
        </div>
      </div>

      {/* ── Profile card overlapping hero ────────────────────────── */}
      <div style={{ padding: '0 18px', marginTop: -64, position: 'relative' }}>
        <div
          style={{
            background: 'var(--card)',
            borderRadius: 24,
            padding: '18px 16px 16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.14), inset 0 0 0 1px var(--border)',
          }}
        >
          {/* Avatar + name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Avatar */}
            <div
              style={{
                width: 66, height: 66, borderRadius: 18, flexShrink: 0,
                background: avatarGradient, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {provider.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={provider.avatarUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
                  {initials}
                </span>
              )}
            </div>

            {/* Name + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Name + verified */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <h1
                  style={{
                    margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: -0.3,
                    color: 'var(--ink)', flex: 1, minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {provider.name}
                </h1>
              </div>

              {/* Rating pill */}
              {averageRating != null ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                  <Star size={13} fill="#F59E0B" style={{ color: '#F59E0B', flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {averageRating.toFixed(1)}
                  </span>
                  {provider.completedJobsCount != null && (
                    <span style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>
                      · {provider.completedJobsCount} jobs
                    </span>
                  )}
                </div>
              ) : null}

              {/* Area row */}
              {primaryArea && (
                <div
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    marginTop: 3, fontSize: 12.5, color: 'var(--ink-mute)',
                  }}
                >
                  <MapPin size={12} style={{ color: 'var(--brand-purple)', flexShrink: 0 }} />
                  {primaryArea}
                </div>
              )}
            </div>
          </div>

          {/* CTA row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Link
              href={ctaHref}
              style={{
                flex: 1, height: 48, borderRadius: 16, border: 'none',
                background: 'var(--brand-gradient)', color: '#fff',
                fontWeight: 700, fontSize: 15, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none', gap: 6,
              }}
            >
              {isCustomerSignedIn ? 'Request service' : 'Sign in to request'}
            </Link>
            <a
              href={`https://wa.me/27693552447?text=Hi%2C+I%27m+looking+for+${encodeURIComponent(primaryCategoryLabel)}+services`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chat on WhatsApp"
              style={{
                width: 48, height: 48, borderRadius: 16, border: 'none',
                background: '#25D366', color: '#fff', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none',
                boxShadow: '0 6px 18px rgba(37,211,102,0.35)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* ── Trust strip ──────────────────────────────────────────── */}
      <div style={{ padding: '16px 18px 0' }}>
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
            background: 'var(--border)', borderRadius: 16, overflow: 'hidden',
          }}
        >
          {[
            { v: yearsExp,   l: 'Experience' },
            { v: provider.completedJobsCount != null ? String(provider.completedJobsCount) : '—', l: 'Jobs done' },
            { v: onTimeLabel, l: 'On-time' },
          ].map((s, i) => (
            <div
              key={i}
              style={{ background: 'var(--card)', padding: '12px 4px', textAlign: 'center' }}
            >
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--ink)', letterSpacing: -0.3 }}>
                {s.v}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-[18px] space-y-5 pt-5">

        {/* ── About ─────────────────────────────────────────────── */}
        {provider.bio && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              About
            </p>
            <p className="text-[14px] leading-[1.55]" style={{ color: 'var(--ink)' }}>
              {provider.bio}
            </p>
          </section>
        )}

        {/* ── Services ──────────────────────────────────────────── */}
        {chips.length > 0 && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Services
            </p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map(c => (
                <span
                  key={c}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 999,
                    fontSize: 12.5, fontWeight: 600,
                    background: 'var(--brand-gradient-soft)',
                    color: 'var(--brand-purple)',
                    display: 'inline-flex', alignItems: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Pricing & terms ───────────────────────────────────── */}
        {provider.providerRates.length > 0 && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Pricing & terms
            </p>
            <div
              className="rounded-[18px] overflow-hidden"
              style={{ boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              {mainRate && [
                mainRate.callOutFee != null
                  ? { l: 'Call-out fee', v: `R${mainRate.callOutFee.toNumber()}` }
                  : { l: 'Call-out fee', v: 'On request' },
                mainRate.hourlyRate != null
                  ? { l: 'Hourly rate', v: mainRate.rateNegotiable ? `From R${mainRate.hourlyRate.toNumber()}` : `R${mainRate.hourlyRate.toNumber()}/hr` }
                  : { l: 'Hourly rate', v: mainRate.rateNegotiable ? 'Negotiable' : 'On request' },
              ].map((row, i, arr) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '13px 16px',
                    background: 'var(--card)',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 13.5, color: 'var(--ink-mute)' }}>{row.l}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{row.v}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Where I work ──────────────────────────────────────── */}
        {provider.serviceAreas.length > 0 && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Where I work
            </p>
            <div className="flex flex-wrap gap-1.5">
              {provider.serviceAreas.slice(0, 10).map(area => (
                <span
                  key={area}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium"
                  style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink)' }}
                >
                  <MapPin size={11} style={{ color: 'var(--brand-purple)', flexShrink: 0 }} />
                  {area}
                </span>
              ))}
              {provider.serviceAreas.length > 10 && (
                <span
                  className="inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-medium"
                  style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink-mute)' }}
                >
                  +{provider.serviceAreas.length - 10} more
                </span>
              )}
            </div>
          </section>
        )}

        {/* ── Provider evidence note ────────────────────────────── */}
        {provider.evidenceNote && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Provider note
            </p>
            <div
              className="rounded-[18px] p-4"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              <p className="text-[13.5px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                {provider.evidenceNote}
              </p>
              <p className="text-[11px] mt-2" style={{ color: 'var(--ink-mute)' }}>
                Provider-shared — not independently reviewed by Plug A Pro
              </p>
            </div>
          </section>
        )}

        {/* ── Portfolio ─────────────────────────────────────────── */}
        {provider.portfolioUrls.length > 0 && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Portfolio
            </p>
            <div
              className="rounded-[18px] p-4 space-y-2.5"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              {provider.portfolioUrls.map(url => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13.5px] font-medium press-feedback"
                  style={{ color: 'var(--brand-purple)' }}
                >
                  <ExternalLink size={13} className="shrink-0" />
                  <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ── Reviews ───────────────────────────────────────────── */}
        <section>
          <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
            Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
          </p>
          {reviews.length === 0 ? (
            <div
              className="rounded-[18px] p-5 text-center"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>No reviews yet</p>
              <p className="text-[12.5px] mt-1" style={{ color: 'var(--ink-mute)' }}>
                Be the first to request and review this provider.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div
                  key={review.id}
                  className="rounded-[18px] p-4"
                  style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(n => (
                        <Star
                          key={n}
                          size={13}
                          fill={n <= review.score ? '#F59E0B' : 'none'}
                          stroke={n <= review.score ? '#F59E0B' : 'var(--border)'}
                        />
                      ))}
                    </div>
                    <span className="text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
                      {review.createdAt.toLocaleDateString('en-ZA', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="mt-2 text-[13.5px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                      {review.comment}
                    </p>
                  )}
                  {jobCategoryMap.get(review.jobId) && (
                    <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
                      {labelForCategory(jobCategoryMap.get(review.jobId)!)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Trust disclaimer ──────────────────────────────────── */}
        <div
          className="rounded-[18px] p-4 mb-4"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <p className="text-[11px] font-bold tracking-[0.06em] uppercase mb-1" style={{ color: 'var(--ink-mute)' }}>
            {provider.verified ? 'Application reviewed by Plug A Pro' : 'Provider-supplied profile'}
          </p>
          <p className="text-[12px] leading-[1.55]" style={{ color: 'var(--ink-mute)' }}>
            Skills, bio, and service areas are supplied by the provider. Plug A Pro records completed
            jobs and customer reviews but does not claim licensing or workmanship guarantees.
          </p>
        </div>
      </div>
    </div>
  )
}
