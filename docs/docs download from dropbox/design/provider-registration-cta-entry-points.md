# Provider Registration CTA Entry Points

Date: 2026-06-06

## Canonical Route

- Marketing surfaces link to `https://app.plugapro.co.za/provider/register` through `getAppUrl()` plus `/provider/register`.
- PWA surfaces link internally to `/provider/register`.
- `/join` remains the flyer short URL for provider sign-in and is not repurposed.
- WhatsApp onboarding remains available as support and assisted onboarding, not the only visible provider entry point.

## CTA Map

| Surface | CTA | Destination |
| --- | --- | --- |
| Marketing desktop nav | `Join as a Provider` | `getAppUrl()/provider/register` |
| Marketing mobile menu | `Register as a Service Provider` | `getAppUrl()/provider/register` |
| Marketing hero | `Register as a Service Provider` | `getAppUrl()/provider/register` |
| Provider story section | `Register as a Provider` | `getAppUrl()/provider/register` |
| `/for-providers` header | `Register as a Service Provider` | `getAppUrl()/provider/register` |
| `/for-providers` eligibility | `Register as a Service Provider` | `getAppUrl()/provider/register` |
| Marketing footer | `Register as a Service Provider` | `getAppUrl()/provider/register` |
| PWA customer home provider card | `Join as provider` | `/provider/register` |
| PWA customer sign-in | `Register as a Service Provider` | `/provider/register` |
| PWA provider sign-in recovery | `Register as a Service Provider` | `/provider/register` |

## Role-Aware Entry Rules

- Unauthenticated users can open `/provider/register` and `/api/provider/registration/*`.
- Logged-in customers can enter registration without being silently converted to a provider.
- Active drafts resume to the next incomplete registration step.
- Pending, more-info, rejected and cancelled applications route to `/provider/register/status`.
- Approved applications and active provider sessions route to `/provider`.

## Analytics

- Marketing emits `provider_registration_cta_click` with `source` and `destination: "/provider/register"`.
- Marketing also keeps the existing generic `cta_click` event for funnel continuity.
- PWA registration logs non-blocking `console.info(JSON.stringify(...))` events for `provider_registration_start` and `provider_registration_resume`.

## Risks And Follow-Ups

- Cross-origin marketing links depend on `NEXT_PUBLIC_APP_URL`; preview environments should verify the app URL before campaign use.
- Provider registration conversion should be reviewed by source after launch because WhatsApp support remains available and can split attribution.
- Browser coverage should be added once stable seeded fixtures exist for anonymous, customer, pending-provider and approved-provider states.
