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
  { href: '/admin/providers', label: 'Providers', icon: 'users' as const },
  { href: '/admin/customers', label: 'Customers', icon: 'users' as const },
  { href: '/admin/categories', label: 'Categories', icon: 'categories' as const },
  { href: '/admin/locations', label: 'Locations', icon: 'categories' as const },
  { href: '/admin/disputes', label: 'Disputes', icon: 'disputes' as const },
  { href: '/admin/payments', label: 'Payments', icon: 'payments' as const },
  { href: '/admin/provider-credit-payments', label: 'Credit Top-ups', icon: 'payments' as const },
  { href: '/admin/vouchers', label: 'Vouchers', icon: 'payments' as const },
  { href: '/admin/provider-wallets', label: 'Provider Wallets', icon: 'payments' as const },
  { href: '/admin/lead-unlock-disputes', label: 'Lead Refunds', icon: 'disputes' as const },
  { href: '/admin/reports', label: 'Reports', icon: 'reports' as const },
  { href: '/admin/messages', label: 'Messages', icon: 'messages' as const },
  { href: '/admin/team', label: 'Team', icon: 'users' as const },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' as const },
  { href: '/admin/otp-security', label: 'OTP Security', icon: 'workflow' as const },
  { href: '/admin/audit-log', label: 'Audit Log', icon: 'workflow' as const },
] as const

// Smoke suite route targets are derived from the sidebar source to prevent
// stale route strings from drifting into tests.
export const ADMIN_SMOKE_ROUTES = ADMIN_NAV_ITEMS.map((item) => item.href)

// Public client routes that must stay reachable after deploy.
export const CLIENT_PUBLIC_SMOKE_ROUTES = [
  '/', // customer homepage — redesigned in recent commits; keep smoke-covered
  '/requests/access/recovery?reason=invalid',
  '/book/plumbing',
  '/for-providers', // renamed from /provider — kept separate from the authenticated /provider/* tree
] as const
