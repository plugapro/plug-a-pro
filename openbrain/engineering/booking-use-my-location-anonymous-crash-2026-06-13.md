# "Use my current location" showed a cryptic WebKit error for anonymous users (2026-06-13)

## Context

On the booking "Service address" step (`/book/[serviceId]`, Step 1 of 3), tapping
**"Use my current location"** while **signed out** showed a red banner reading
**"The string did not match the expected pattern."** Reported from iPhone Safari.
(User confirmed repro: signed-out + tapped "Use my current location".)

## Root cause

The booking address step is intentionally public (`proxy.ts` — "booking steps
1-3 are public; submit endpoint enforces auth"), so an anonymous visitor reaches
it. `handleUseMyLocation` (`components/customer/BookingFlow.tsx`) gets the
geolocation fix, then calls `fetch('/api/customer/location-reverse?lat=..&lng=..')`.

But that API path was **not** in the proxy's `PUBLIC_PATHS` and the route required
`session.role === 'customer'`. For a request with no `sb-access-token` cookie the
proxy ran `redirectToSignIn()` → **307 to `/sign-in`**. `fetch` follows redirects
by default, so it landed on the **sign-in HTML page with status 200**. The client
saw `res.ok === true`, skipped its error branch, and ran `await res.json()` on an
**HTML document**. In **WebKit/Safari** the JSON-parse failure message is exactly
**"The string did not match the expected pattern."** (Chrome says "Unexpected
token '<'".) `handleUseMyLocation`'s catch then did `setError(err.message)` and
surfaced that raw native text.

Three compounding faults:
1. The anonymous funnel called an endpoint the proxy redirected (silent
   redirect-to-HTML → `res.json()` crash).
2. `BookingFlow` surfaced raw `err.message` and logged nothing.
3. Back / province-change didn't clear `error`, so the banner could also linger
   on an unrelated step (explains seeing it on a blank Step 1).

### Ruled out (verified)
- `lib/geocoding.ts` `reverseGeocodeCoordinates` never throws (catches all →
  null); the route's own errors are friendly strings.
- `SuburbPicker` has its own inline error and never sets BookingFlow's banner.
- `getStoredUtm`/UTM helpers are fully guarded. No client-side Google/Mapbox
  geocoder. `getCurrentPosition` is the only geolocation entry point.

## Fix applied

- **Restore the anonymous funnel:** added `/api/customer/location-reverse` to
  `proxy.ts` `PUBLIC_PATHS` and removed the route's session gate. Reverse-geocoding
  public coordinates exposes no user data; a new **per-IP rate limit**
  (`checkLocationReverseLimit`, `locationReverseByIp`, default 60/IP/hour, fails
  OPEN like the other public dependency-protecting limiters) protects the
  Nominatim dependency. Also tightened coordinate validation to in-range lat/lng.
- **Client hardening:** `handleUseMyLocation` now sends `Accept: application/json`
  and treats a redirected / non-JSON response as a handled failure **before**
  `res.json()` runs, so HTML can never reach the parser. The catch no longer
  surfaces raw `err.message` — it `console.error`s the real error and shows
  "We could not read your location. Please enter your suburb below."
- **Stale error:** `setError(null)` on the Back button and on province change.

## Tests

- `__tests__/api/location-reverse.test.ts` — anonymous caller gets 200 +
  selection; 429 when rate-limited; 400 for non-finite/out-of-range coords; 404
  when nothing resolves.
- `__tests__/proxy.test.ts` — anonymous reverse-geocode request passes through
  (200, no redirect) instead of 307→/sign-in.

## Validation

- `pnpm exec eslint` (changed files) — 0 errors.
- `pnpm exec tsc --noEmit` — 0 errors.
- `pnpm vitest run` — **4337 passed, 1 skipped, 0 failed** (incl. 5 new).
- Not done: live iOS Safari repro on app.plugapro.co.za (needs the device + a real
  geolocation grant). Proven by the static redirect→HTML→`res.json()` trace plus
  the route/proxy tests.

## Remaining risks / follow-ups

- Per-IP limit + shared carrier NAT: South African mobile users often share a
  carrier IP, so a busy area could brush the 60/IP/hour cap. Tunable via
  `LOCATION_REVERSE_LIMIT_PER_IP_HOUR`; bump if legitimate lookups get throttled.
- No global Nominatim budget guard (only per-IP). Static SA suburb lookup handles
  most cases; consider a global limiter if reverse-geocode volume grows.
