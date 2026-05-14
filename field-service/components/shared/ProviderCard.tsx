import * as React from 'react'
import Link from 'next/link'
import { Check, MapPin, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProviderCardData {
  id: string
  name: string
  /** Short business or trading name — kept for backward compat, not shown in new design. */
  businessName?: string | null
  avatarUrl?: string | null
  /** Skills used for service chips. Prefer subServices over skills when both present. */
  skills?: string[]
  /** Sub-services from providerCategories — shown as chips when present. */
  subServices?: string[]
  mainCategory?: string | null
  /** Experience label, e.g. "5 yrs" or "3–5 years". */
  experience?: string | null
  serviceArea?: string | null
  averageRating?: number | null
  completedJobsCount?: number | null
  /** True when KYC and trust checks have passed. */
  verified?: boolean
  /** Optional response-time hint — kept for compat, not shown in new design. */
  responseTime?: string | null
  availableNow?: boolean
  /** Call-out fee in Rands (not cents). */
  callOutFee?: number | null
  /** Hourly labour rate in cents — kept for backward compat, not shown in new design. */
  labourRateCents?: number | null
  rateNegotiable?: boolean
  /** CSS color / gradient hint for avatar background, e.g. "#2A78F0". */
  tone?: string
}

interface ProviderCardProps {
  provider: ProviderCardData
  /** Where the card link points. Falls back to /providers/[id]. */
  href?: string
  /** Optional node rendered below the card (kept for backward compat). */
  action?: React.ReactNode
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * Design-spec provider card. Surfaces avatar, name, verification, rating,
 * completed jobs, location, service chips, call-out fee, and availability.
 * All values are optional — only present data is rendered.
 */
export function ProviderCard({
  provider,
  href,
  action,
  className,
}: ProviderCardProps) {
  const target = href ?? `/providers/${provider.id}`

  const avatarGradient = provider.tone
    ? `linear-gradient(135deg, ${provider.tone}, #2A78F0)`
    : 'linear-gradient(135deg, #8B3FE8, #2A78F0)'

  const chips = (
    (provider.subServices && provider.subServices.length > 0
      ? provider.subServices
      : provider.skills) ?? []
  ).slice(0, 4)

  const hasBottomRow =
    provider.callOutFee != null ||
    provider.availableNow !== undefined ||
    true // always render bottom row per spec

  return (
    <>
      <Link
        href={target}
        className={cn('block', className)}
        style={{
          borderRadius: 24,
          background: 'var(--card)',
          boxShadow: 'inset 0 0 0 1px var(--border)',
          padding: '14px 16px',
          cursor: 'pointer',
          textDecoration: 'none',
        }}
      >
        {/* Top row: avatar + name column */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {/* Avatar */}
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: avatarGradient,
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
              <span
                style={{
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 17,
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {initials(provider.name)}
              </span>
            )}
          </div>

          {/* Name column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Row 1: Name + verified badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: '-0.2px',
                  color: 'var(--ink)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {provider.name}
              </span>
              {provider.verified ? (
                <span
                  aria-label="Verified provider"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: 'var(--brand-gradient-soft)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Check
                    size={11}
                    style={{ color: 'var(--brand-purple)', strokeWidth: 3 }}
                  />
                </span>
              ) : null}
            </div>

            {/* Row 2: Rating pill */}
            {provider.averageRating != null ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 2,
                }}
              >
                <Star
                  size={13}
                  style={{ color: '#F59E0B', fill: '#F59E0B', flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink)',
                  }}
                >
                  {provider.averageRating.toFixed(1)}
                </span>
                {provider.completedJobsCount != null ? (
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    · {provider.completedJobsCount} jobs
                  </span>
                ) : null}
              </div>
            ) : provider.completedJobsCount != null ? (
              <div style={{ marginTop: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                  {provider.completedJobsCount} jobs completed
                </span>
              </div>
            ) : null}

            {/* Row 3: Location row */}
            {(provider.serviceArea || provider.experience) ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  marginTop: 2,
                }}
              >
                <MapPin
                  size={12}
                  style={{ color: 'var(--brand-purple)', flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                  {provider.serviceArea}
                  {provider.serviceArea && provider.experience ? ` · ${provider.experience}` : provider.experience}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Service chips */}
        {chips.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 12,
            }}
          >
            {chips.map((chip) => (
              <span
                key={chip}
                style={{
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--brand-gradient-soft)',
                  color: 'var(--brand-purple)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {chip.replaceAll('_', ' ')}
              </span>
            ))}
          </div>
        ) : null}

        {/* Divider */}
        <div
          aria-hidden
          style={{
            height: 1,
            background: 'var(--border)',
            marginTop: 12,
          }}
        />

        {/* Bottom row: price + availability */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
          }}
        >
          {/* Left: call-out fee */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            {provider.callOutFee != null ? (
              <>
                <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
                  Call-out from
                </span>
                <span
                  style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}
                >
                  R{provider.callOutFee}
                </span>
                {provider.rateNegotiable ? (
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                    · rate negotiable
                  </span>
                ) : null}
              </>
            ) : (
              <span style={{ color: 'var(--ink-mute)', fontSize: 12 }}>
                Call-out on request
              </span>
            )}
          </div>

          {/* Right: availability chip */}
          {provider.availableNow ? (
            <span
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: 'rgba(15,157,88,0.10)',
                color: '#0F7A45',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#0F7A45',
                  flexShrink: 0,
                }}
              />
              Available now
            </span>
          ) : (
            <span
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: 'rgba(230,153,0,0.10)',
                color: '#A66400',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#A66400',
                  flexShrink: 0,
                }}
              />
              Busy today
            </span>
          )}
        </div>
      </Link>
      {action ? <div>{action}</div> : null}
    </>
  )
}
