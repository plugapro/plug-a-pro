# PWA homepage auth-aware navigation

Date: 2026-05-10
Status: implemented

Decision:
Plug A Pro PWA homepage and navigation must be auth-aware. Logged-out users should see `Sign in` / `Request a service` / `Join as provider` actions, not profile-owned labels. Logged-in customer and provider users should see role-appropriate navigation and account access.

Implementation notes:
- Customer shell (`app/(customer)/layout.tsx`) now resolves session + role context and maps header + bottom nav per auth state:
  - guest: `Home / Request / Sign in`
  - customer: `Home / Bookings / Profile`
  - provider: `Dashboard / Jobs / Profile`
  - multi-role: mixed context-switch nav including provider entry
- Homepage (`app/(customer)/page.tsx`) now renders role-aware hero copy and CTA sets.
- Multi-role users now get explicit context switch options (`Request a service` and `Provider dashboard`).
- Provider and customer activity cards use safe DB-count lookups and graceful fallback copy when queries fail.

Safety notes:
- No private provider/customer details are exposed in public mode.
- No WhatsApp token/deep-link behavior was modified.
