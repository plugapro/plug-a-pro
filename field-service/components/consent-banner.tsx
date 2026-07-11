'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { isSensitiveTokenRoute } from '@/lib/sensitive-token-routes'
import { applyConsentToGtag, readConsent, writeConsent } from '@/lib/consent'
import { consentBannerBottomClass } from '@/lib/consent-banner-layout'

// POPIA-aware Google Consent Mode v2 banner for the app. GA loads with consent
// defaulted to "denied" (see components/google-analytics.tsx), so no analytics/ad
// cookies are set until the visitor accepts here. Positioned above the bottom nav.

export function ConsentBanner() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [customising, setCustomising] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  useEffect(() => {
    const stored = readConsent()
    if (stored) {
      applyConsentToGtag(stored)
      return
    }
    // Consent is unknown only on the client (localStorage); reveal in this mount
    // effect. Renders hidden on the server to match SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true)
  }, [])

  // No analytics runs on token routes, so no consent prompt there either.
  if (!visible || isSensitiveTokenRoute(pathname)) return null

  function save(next: { analytics: boolean; marketing: boolean }) {
    const consent = writeConsent(next)
    applyConsentToGtag(consent)
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className={`fixed inset-x-0 z-[60] px-3 ${consentBannerBottomClass(pathname)}`}
    >
      <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          We use cookies to keep Plug A Pro working, improve it, and reach more customers. You choose
          what we set.{' '}
          <a
            href="https://plugapro.co.za/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Privacy
          </a>
        </p>

        {customising ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-foreground">Essential</p>
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Required to sign in and keep the app working. Always on.
                </p>
              </div>
              <span className="text-[12px] font-medium text-muted-foreground">Always on</span>
            </div>

            <label className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-foreground">Analytics</p>
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Helps us understand what works.
                </p>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Analytics cookies"
              />
            </label>

            <label className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-foreground">Marketing</p>
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Lets us show you Plug A Pro ads on other sites.
                </p>
              </div>
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Marketing cookies"
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCustomising(false)}>
                Back
              </Button>
              <Button size="sm" onClick={() => save({ analytics, marketing })}>
                Save choices
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCustomising(true)}
              aria-expanded={false}
            >
              Customise
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => save({ analytics: false, marketing: false })}
            >
              Reject all
            </Button>
            <Button size="sm" onClick={() => save({ analytics: true, marketing: true })}>
              Accept all
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
