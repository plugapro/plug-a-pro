# CLIENT-13 — Auth-aware Homepage and Navigation

## Status
Completed

## Summary
- Updated the public/customer PWA shell and homepage to render correctly for four auth contexts:
  - logged-out visitor
  - logged-in customer
  - logged-in provider
  - multi-role user (customer + provider)
- Removed misleading logged-out chrome that implied an authenticated profile state.
- Improved first-screen clarity and commercial credibility with explicit action-driven CTAs and stronger visual hierarchy.

## Behaviour changes

### Logged-out users
- Header action now shows `Sign in` (no `My Account` label).
- Bottom nav now shows `Home`, `Request`, `Sign in`.
- Homepage emphasizes:
  - `Request a service`
  - `Find a provider`
  - `Join as a service provider`
  - explicit `Sign in`

### Logged-in customers
- Header action shows `My Account`.
- Bottom nav stays customer-native: `Home`, `Bookings`, `Profile`.
- Homepage shows lightweight welcome and customer activity card.

### Logged-in providers
- Header action shows `Provider Portal`.
- Bottom nav switches to provider-relevant actions: `Dashboard`, `Jobs`, `Profile`.
- Homepage hero and CTA set switches to provider workspace actions.

### Multi-role users
- Header action shows `Provider Portal`.
- Bottom nav includes both customer and provider context switching paths.
- Homepage renders explicit role chooser card:
  - `Request a service`
  - `Provider dashboard`

## Files changed
- `app/(customer)/layout.tsx`
  - auth-aware header action
  - auth/role-aware bottom nav model
  - provider/customer dual-role detection
- `app/(customer)/page.tsx`
  - auth-aware hero copy and CTA mapping
  - multi-role context switch panel
  - provider and customer activity cards
  - refined visual treatment using existing theme tokens
- `__tests__/app/customer/customer-landing-page.test.ts`
  - expanded rendering coverage for logged-out, provider, and multi-role states
- `__tests__/app/customer/customer-layout-auth-nav.test.ts`
  - added shell/navigation auth-state regression coverage

## Notes
- Routing remains aligned with existing flow ownership:
  - customer request entry via `/services`
  - provider workspace via `/provider/*`
  - sign-in via `/sign-in`
- No WhatsApp deep-link logic was changed in this task.
