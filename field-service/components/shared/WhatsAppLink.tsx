'use client'

import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { analytics } from '@/lib/analytics'
import { fireGoogleAdsConversion } from '@/lib/marketing/google-ads'

interface WhatsAppLinkProps {
  href: string
  source: string
  ctaLabel: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  target?: string
  rel?: string
  'aria-label'?: string
}

export function WhatsAppLink({
  href,
  source,
  ctaLabel,
  children,
  className,
  style,
  target = '_blank',
  rel = 'noopener noreferrer',
  'aria-label': ariaLabel,
}: WhatsAppLinkProps) {
  function handleClick(_event: MouseEvent<HTMLAnchorElement>) {
    analytics.whatsappClick({ source, cta_label: ctaLabel })
    // transaction_id lets Google Ads dedupe the same click signal arriving via
    // multiple touchpoints; the source slug is stable per CTA.
    fireGoogleAdsConversion('whatsapp', { transactionId: source })
  }

  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={className}
      style={style}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
