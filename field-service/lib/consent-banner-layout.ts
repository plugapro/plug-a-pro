// Bottom-offset selection for the cookie consent banner.
//
// The banner is `position: fixed` near the bottom of the viewport. Its offset
// has to clear whatever bottom bar the current route shows so it never covers
// an interactive control.
//
// - Client (customer) routes render a ~76px bottom navigation bar.
// - The provider registration wizard (/provider/register[/*]) has NO bottom nav
//   but its own taller (~129px) fixed action bar containing the primary CTA
//   ("Start application" etc). With the default 76px offset the banner overlapped
//   that CTA and, being a higher z-index, swallowed taps — the button appeared
//   dead until the banner was dismissed.
//
// Both return values are written as full literal class strings so Tailwind's
// content scanner emits them.

const DEFAULT_BOTTOM_OFFSET = 'bottom-[calc(76px+env(safe-area-inset-bottom,0px))]'
const REGISTRATION_BOTTOM_OFFSET = 'bottom-[calc(148px+env(safe-area-inset-bottom,0px))]'

/** True for the provider registration wizard, which has a tall bottom action bar. */
export function hasTallBottomActionBar(pathname: string | null): boolean {
  if (!pathname) return false
  return pathname === '/provider/register' || pathname.startsWith('/provider/register/')
}

/** Tailwind class positioning the consent banner clear of the route's bottom bar. */
export function consentBannerBottomClass(pathname: string | null): string {
  return hasTallBottomActionBar(pathname) ? REGISTRATION_BOTTOM_OFFSET : DEFAULT_BOTTOM_OFFSET
}
