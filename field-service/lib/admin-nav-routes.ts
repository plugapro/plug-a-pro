// Shared admin navigation routes.
// This file is the single source for admin route smoke checks and the admin UI
// sidebar so stale-route drift is caught early.

export const ADMIN_NAV_ITEMS = [
  { href: '/admin', label: 'Operations', icon: 'operations' as const },
  { href: '/admin/validation', label: 'Validation', icon: 'workflow' as const },
  { href: '/admin/dispatch', label: 'Dispatch', icon: 'dispatch' as const },
  { href: '/admin/quotes', label: 'Quotes', icon: 'reports' as const },
  { href: '/admin/bookings', label: 'Bookings', icon: 'jobs' as const },
  { href: '/admin/applications', label: 'Applications', icon: 'applications' as const },
  { href: '/admin/verifications', label: 'Verifications', icon: 'workflow' as const },
  { href: '/admin/providers', label: 'Providers', icon: 'users' as const },
  { href: '/admin/quality', label: 'Provider Quality', icon: 'workflow' as const },
  { href: '/admin/customers', label: 'Customers', icon: 'users' as const },
  { href: '/admin/categories', label: 'Categories', icon: 'categories' as const },
  { href: '/admin/locations', label: 'Locations', icon: 'categories' as const },
  { href: '/admin/disputes', label: 'Disputes', icon: 'disputes' as const },
  { href: '/admin/payments', label: 'Payments', icon: 'payments' as const },
  { href: '/admin/provider-credit-payments', label: 'Credit Top-ups', icon: 'payments' as const },
  { href: '/admin/vouchers', label: 'Vouchers', icon: 'payments' as const },
  { href: '/admin/provider-wallets', label: 'Provider Wallets', icon: 'payments' as const },
  { href: '/admin/lead-unlock-disputes', label: 'Lead Refunds', icon: 'disputes' as const },
  { href: '/admin/commercial/provider-economics', label: 'Economics', icon: 'reports' as const },
  { href: '/admin/reports', label: 'Reports', icon: 'reports' as const },
  { href: '/admin/messages', label: 'Messages', icon: 'messages' as const },
  { href: '/admin/otp-delivery', label: 'OTP Delivery', icon: 'messages' as const },
  { href: '/admin/team', label: 'Team', icon: 'users' as const },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' as const },
  { href: '/admin/otp-security', label: 'OTP Security', icon: 'workflow' as const },
  { href: '/admin/audit-log', label: 'Audit Log', icon: 'workflow' as const },
  // Flag-gated launch routes: the page 404s while its flag is off, so the sidebar
  // (app/(admin)/layout.tsx) hides these until the flag is on, and they are excluded
  // from the unconditional smoke list below (covered by ADMIN_FLAGGED_SMOKE_ROUTES).
  {
    href: '/admin/launch-readiness',
    label: 'Launch Readiness',
    icon: 'reports' as const,
    flag: 'launch.west_rand_pilot.readiness_report' as const,
  },
  {
    href: '/admin/nudges',
    label: 'Nudges',
    icon: 'messages' as const,
    flag: 'launch.west_rand_pilot.nudge_console' as const,
  },
  {
    href: '/admin/ops-intelligence',
    label: 'Ops Intelligence',
    icon: 'workflow' as const,
    flag: 'admin.ops_intelligence' as const,
  },
  // Tier 1 funnel observability — admin customer-funnel report.
  // Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
  {
    href: '/admin/reports/funnel',
    label: 'Customer Funnel',
    icon: 'reports' as const,
    flag: 'admin.reports.customer_funnel' as const,
  },
  // Provider KYC funnel report (PR #148) — page 404s while its flag is off.
  {
    href: '/admin/reports/kyc-funnel',
    label: 'KYC Funnel',
    icon: 'reports' as const,
    flag: 'admin.reports.kyc_funnel' as const,
  },
] as const

// Smoke suite route targets are derived from the sidebar source to prevent
// stale route strings from drifting into tests. Flag-gated routes are excluded
// because they intentionally 404 while their flag is off.
export const ADMIN_SMOKE_ROUTES = ADMIN_NAV_ITEMS.filter((item) => !('flag' in item)).map(
  (item) => item.href,
)

// Flag-gated routes get a lenient smoke check instead: no 5xx and no error shell,
// but a 404 (flag off) is acceptable.
export const ADMIN_FLAGGED_SMOKE_ROUTES = ADMIN_NAV_ITEMS.filter((item) => 'flag' in item).map(
  (item) => item.href,
)

// Public client routes that must stay reachable after deploy.
export const CLIENT_PUBLIC_SMOKE_ROUTES = [
  '/', // customer homepage - redesigned in recent commits; keep smoke-covered
  '/requests/access/recovery?reason=invalid',
  '/security/otp/report?token=smoke-invalid',
  '/book/plumbing',
  '/for-providers', // renamed from /provider - kept separate from the authenticated /provider/* tree
  '/provider/signup?t=invalid', // provider web signup finish page with invalid token
  '/status', // public platform status dashboard - must stay reachable post-deploy
] as const
