'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { isSensitiveTokenRoute } from '@/lib/sensitive-token-routes'

// GA4 for the app (app.plugapro.co.za). Uses the SAME measurement ID as the
// marketing site so both domains report to one GA4 property (cross-domain funnel).
//
// Consent Mode v2: defaults to denied (the ConsentBanner flips to granted on accept).
// Token-route suppression: never loads gtag or fires a page_view on a tokenized
// magic-link route, so a bearer token in the URL is never sent to Google — mirrors
// the Meta Pixel protection (see lib/sensitive-token-routes).

type GtagWindow = typeof window & { gtag?: (...args: unknown[]) => void }

export function GoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname()

  useEffect(() => {
    if (isSensitiveTokenRoute(pathname)) return
    const w = window as GtagWindow
    if (typeof w.gtag === 'function') {
      w.gtag('event', 'page_view', { page_path: pathname })
    }
  }, [pathname])

  if (isSensitiveTokenRoute(pathname)) return null

  return (
    <>
      <Script
        id="ga-lib"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script
        id="ga-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html:
            `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
            `gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});` +
            // send_page_view:false so page_view is fired manually above and can be
            // suppressed on token routes.
            `gtag('js',new Date());gtag('config','${gaId}',{send_page_view:false});`,
        }}
      />
    </>
  )
}
