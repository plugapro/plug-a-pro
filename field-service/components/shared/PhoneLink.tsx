'use client'

import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { analytics } from '@/lib/analytics'
import { fireGoogleAdsConversion } from '@/lib/marketing/google-ads'

interface PhoneLinkProps {
  href: string
  source: string
  ctaLabel: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function PhoneLink({
  href,
  source,
  ctaLabel,
  children,
  className,
  style,
  'aria-label': ariaLabel,
}: PhoneLinkProps) {
  function handleClick(_event: MouseEvent<HTMLAnchorElement>) {
    analytics.phoneClick({ source, cta_label: ctaLabel })
    fireGoogleAdsConversion('phone', { transactionId: source })
  }

  return (
    <a href={href} className={className} style={style} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </a>
  )
}
