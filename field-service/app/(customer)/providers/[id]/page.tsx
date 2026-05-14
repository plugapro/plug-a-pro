export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { isEnabled } from '@/lib/flags'
import { ArrowLeft, MapPin, ShieldCheck, Zap, Star, ExternalLink } from 'lucide-react'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

const CATEGORY_LABELS = new Map(SERVICE_CATEGORY_OPTIONS.map(o => [o.tag, o.label]))

function labelForCategory(tag: string) {
  return CATEGORY_LABELS.get(tag) ?? tag.replaceAll('_', ' ')
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

  const jobs = await db.job.findMany({
    where: { providerId: provider.id, status: 'COMPLETED' },
    include: {
      booking: {
        include: {
          match: { include: { jobRequest: { select: { category: true } } } },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
    take: 25,
  })

  const reviews = await db.review.findMany({
    where: { reviewerType: 'CUSTOMER', jobId: { in: jobs.map(j => j.id) } },
    orderBy: { createdAt: 'desc' },
  })

  const averageRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length
      : null

  const bookingCategory =
    provider.providerCategories[0]?.categorySlug ?? provider.skills[0] ?? 'other'
  const bookingUrl = `/book/${encodeURIComponent(bookingCategory)}?provider=${encodeURIComponent(provider.id)}`
  const ctaHref = isCustomerSignedIn ? bookingUrl : `/sign-in?next=${encodeURIComponent(bookingUrl)}`
  const ctaLabel = isCustomerSignedIn ? 'Request service' : 'Sign in to request service'

  const initials =
    provider.name?.split(' ').map(s => s[0]).slice(0, 2).join('') ?? 'P'
  const mainCategoryLabel =
    provider.providerCategories.length > 0
      ? labelForCategory(provider.providerCategories[0].categorySlug)
      : (provider.skills[0] ?? 'General services')

  return (
    <div className="pb-32 screen-enter">

      {/* ── Back nav ─────────────────────────────────────────────── */}
      <div className="px-[18px] pt-[60px] pb-2">
        <Link
          href="/providers"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold press-feedback"
          style={{ color: 'var(--ink-mute)' }}
        >
          <ArrowLeft size={15} />
          Providers
        </Link>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="px-[18px] pt-3 pb-5">
        <div className="flex items-start gap-4">
          <div
            className="shrink-0 w-20 h-20 rounded-[20px] overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
          >
            {provider.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={provider.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[22px] font-bold text-white">
                {initials}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 pt-1">
            <p
              className="text-[11px] font-bold tracking-[0.06em] uppercase mb-0.5"
              style={{ color: 'var(--brand-purple)' }}
            >
              {mainCategoryLabel}
            </p>
            <h1
              className="text-[22px] font-bold tracking-[-0.025em] leading-tight"
              style={{ color: 'var(--ink)' }}
            >
              {provider.name}
            </h1>
            {provider.experience && (
              <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                {provider.experience}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {provider.verified && (
                <span
                  className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-bold tracking-[0.04em] uppercase"
                  style={{ background: 'rgba(15,162,138,0.12)', color: '#0FA28A' }}
                >
                  <ShieldCheck size={10} />
                  Reviewed
                </span>
              )}
              {provider.availableNow && (
                <span
                  className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-bold tracking-[0.04em] uppercase"
                  style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
                >
                  <Zap size={10} />
                  Available now
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div
            className="rounded-[14px] px-3 py-3 text-center"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <p className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
              {averageRating ? averageRating.toFixed(1) : '—'}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>
              {averageRating ? '★ Rating' : 'No rating'}
            </p>
          </div>
          <div
            className="rounded-[14px] px-3 py-3 text-center"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <p className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
              {reviews.length}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>Reviews</p>
          </div>
          <div
            className="rounded-[14px] px-3 py-3 text-center"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <p className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
              {jobs.length}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>Jobs done</p>
          </div>
        </div>
      </div>

      <div className="px-[18px] space-y-5">

        {/* ── About ────────────────────────────────────────────────── */}
        {provider.bio && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              About
            </p>
            <p className="text-[14px] leading-[1.65]" style={{ color: 'var(--ink)' }}>
              {provider.bio}
            </p>
          </section>
        )}

        {/* ── Services & rates ─────────────────────────────────────── */}
        {provider.providerCategories.length > 0 && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Services & rates
            </p>
            <div className="space-y-3">
              {provider.providerCategories.map(cat => {
                const rate = provider.providerRates.find(r => r.categorySlug === cat.categorySlug)
                return (
                  <div
                    key={cat.categorySlug}
                    className="rounded-[18px] p-4"
                    style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
                  >
                    <p className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
                      {labelForCategory(cat.categorySlug)}
                    </p>
                    {cat.yearsExperience != null && (
                      <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                        {cat.yearsExperience} {cat.yearsExperience === 1 ? 'year' : 'years'} experience
                      </p>
                    )}
                    {rate && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                        <span className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
                          {rate.callOutFee != null
                            ? `Call-out: R${rate.callOutFee.toNumber()}`
                            : 'Call-out on request'}
                        </span>
                        {rate.hourlyRate != null && (
                          <span className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
                            Hourly: R{rate.hourlyRate.toNumber()}
                          </span>
                        )}
                        <span className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
                          {rate.rateNegotiable ? 'Rate negotiable' : 'Fixed rate'}
                        </span>
                      </div>
                    )}
                    {cat.subServices.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {cat.subServices.map(s => (
                          <span
                            key={s}
                            className="h-6 px-2.5 rounded-full text-[11.5px] font-medium inline-flex items-center"
                            style={{ background: 'var(--card-alt)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Where I work ─────────────────────────────────────────── */}
        {provider.serviceAreas.length > 0 && (
          <section>
            <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
              Where I work
            </p>
            <div className="flex flex-wrap gap-1.5">
              {provider.serviceAreas.slice(0, 8).map(area => (
                <span
                  key={area}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium"
                  style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink)' }}
                >
                  <MapPin size={11} style={{ color: 'var(--brand-purple)', flexShrink: 0 }} />
                  {area}
                </span>
              ))}
              {provider.serviceAreas.length > 8 && (
                <span
                  className="inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-medium"
                  style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--ink-mute)' }}
                >
                  +{provider.serviceAreas.length - 8} more
                </span>
              )}
            </div>
          </section>
        )}

        {/* ── Provider evidence note ───────────────────────────────── */}
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
                Provider-shared — not independently verified by Plug A Pro
              </p>
            </div>
          </section>
        )}

        {/* ── Portfolio ────────────────────────────────────────────── */}
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

        {/* ── Reviews ──────────────────────────────────────────────── */}
        <section>
          <p className="text-[11px] font-bold tracking-[0.08em] uppercase mb-2" style={{ color: 'var(--ink-mute)' }}>
            Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
          </p>
          {reviews.length === 0 ? (
            <div
              className="rounded-[18px] p-5 text-center"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                No reviews yet
              </p>
              <p className="text-[12.5px] mt-1" style={{ color: 'var(--ink-mute)' }}>
                {jobs.length > 0
                  ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} completed on the platform.`
                  : 'Be the first to request and review this provider.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => {
                const job = jobs.find(j => j.id === review.jobId)
                return (
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
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    {review.comment && (
                      <p className="mt-2 text-[13.5px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                        {review.comment}
                      </p>
                    )}
                    {job && (
                      <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
                        {labelForCategory(job.booking.match.jobRequest.category)} · Verified customer
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Trust disclaimer ─────────────────────────────────────── */}
        <div
          className="rounded-[18px] p-4"
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

      {/* ── Sticky CTA ───────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 px-[18px] pt-3"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
          background: 'linear-gradient(to top, var(--background) 60%, transparent)',
        }}
      >
        <Link
          href={ctaHref}
          className="flex items-center justify-center w-full h-[52px] rounded-[16px] text-[15px] font-bold text-white press-feedback"
          style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  )
}
