'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { isSensitiveTokenRoute } from '@/lib/sensitive-token-routes'

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

declare global {
  interface Window {
    fbq: (...args: unknown[]) => void
    _fbq: unknown
  }
}

function PageViewTracker() {
  const pathname = usePathname()
  useEffect(() => {
    // Never emit a PageView (which carries the URL) on a tokenized route.
    if (isSensitiveTokenRoute(pathname)) return
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'PageView')
    }
  }, [pathname])
  return null
}

export function MetaPixel() {
  const pathname = usePathname()
  // Don't even bootstrap the pixel on a tokenized route, so a direct magic-link
  // landing never initialises fbq with the token URL in scope.
  if (!PIXEL_ID || isSensitiveTokenRoute(pathname)) return null

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init','${PIXEL_ID}');
            fbq('track','PageView');
          `,
        }}
      />
      <PageViewTracker />
    </>
  )
}
