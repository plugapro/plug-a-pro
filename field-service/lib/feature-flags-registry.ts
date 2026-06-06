/**
 * Central registry of all feature flags.
 *
 * Add new flags here before using them anywhere else.
 * Each flag has: key (implicit from map), description, owner, defaultValue.
 *
 * The FeatureFlagKey type is used by isEnabled() / isEnabledSync() in lib/flags.ts
 * to give compile-time validation that only registered flags are passed.
 *
 * Env override policy:
 *   Set FEATURE_FLAGS='{"flag.key": true}' to override DB values at boot time.
 *   Env overrides apply to ALL users and bypass per-user rollout (enabledForUsers).
 *   Use env overrides in CI / staging only - never in production.
 *
 * Rollout ownership:
 *   owner: 'eng'   - Engineering; flag controls infrastructure / API surface
 *   owner: 'ops'   - Operations; flag controls admin queue / workflow behaviour
 *   owner: 'prod'  - Product; flag controls customer / provider feature surface
 */

export const FEATURE_FLAGS_REGISTRY = {
  // ─── Admin CRUD surfaces ─────────────────────────────────────────────────────
  'admin.crud.locations': {
    description: 'Enable create/update/delete mutations on the Location Taxonomy admin page.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.crud.customers': {
    description: 'Enable block/suspend/archive mutations on the Customers admin page.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.crud.providers': {
    description: 'Enable verification/suspension mutations on the Providers admin page.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.crud.bookings': {
    description: 'Enable booking cancellation and payment mutations on the Booking detail admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.payments': {
    description: 'Enable payment queue claim and refund mutations on the Payments admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.disputes': {
    description: 'Enable dispute queue claim and resolution mutations on the Disputes admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.applications': {
    description: 'Enable provider application claim/approve/reject mutations on the Applications admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.quotes': {
    description: 'Enable quote queue claim/release mutations on the Quote Approvals admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.dispatch': {
    description: 'Enable dispatch claim, rerank, auto-assign and override mutations on the Dispatch console.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.validation': {
    description: 'Enable validation queue claim, release, promote and cancel mutations on the Validation Queue admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.field_exceptions': {
    description: 'Enable field exception claim and release mutations on the Field Exceptions admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.categories': {
    description: 'Enable DB-backed category config mutations on the Categories admin page.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.categories.risk_tier': {
    description: 'Enable riskTier column and inline LOW/STANDARD selector on the Categories admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.messages': {
    description: 'Enable failed message retry mutations on the Messages admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Admin team / users ──────────────────────────────────────────────────────
  'admin.users.v2': {
    description: 'Enable DB-backed AdminUser team management (invite, role change, deactivate).',
    owner: 'eng',
    defaultValue: false,
  },
  // ─── Admin finance / invoicing ───────────────────────────────────────────────
  'admin.quotes.send': {
    description: 'Enable approve, decline, send and revise admin mutations on the Quote Approvals page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.invoices.actions': {
    description: 'Enable generate, send and void mutations on the Invoices admin page.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.payments.retry': {
    description: 'Enable payment PSP checkout retry on the Payments admin page. Reserved - not yet implemented.',
    owner: 'eng',
    defaultValue: false,
  },
  // ─── Admin messaging ─────────────────────────────────────────────────────────
  'admin.messages.outbound': {
    description: 'Enable admin-initiated outbound WhatsApp sends and broadcast queuing. Capped at BROADCAST_MAX_RECIPIENTS.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Admin customer details ──────────────────────────────────────────────────
  'admin.customers.whatsapp_pref_toggle': {
    description: 'Enable admin toggle of customer WhatsApp service and marketing opt-in preferences.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Ops v2 ──────────────────────────────────────────────────────────────────
  'ops.v2.closeOut': {
    description: 'Ops v2 close-out workflow.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.notes': {
    description: 'Ops v2 notes panel.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.audit': {
    description: 'Ops v2 audit trail panel.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.breachBanner': {
    description: 'Ops v2 SLA breach banner.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.dispatchOverride': {
    description: 'Ops v2 dispatch override action.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.profileV2': {
    description: 'Ops v2 provider profile panel.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.bulkActions': {
    description: 'Ops v2 bulk actions toolbar.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.duplicates': {
    description: 'Ops v2 duplicate detection panel.',
    owner: 'ops',
    defaultValue: false,
  },
  'ops.v2.cases': {
    description: 'Case lifecycle: claim, note, resolve and reopen exception cases across all ops queues.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Qualified Shortlist ─────────────────────────────────────────────────────
  'qualified_shortlist.dispatch_v2': {
    description: "Qualified Shortlist: send free I'm interested / Not interested buttons on dispatch instead of legacy paid Accept Lead buttons.",
    owner: 'prod',
    defaultValue: false,
  },
  'qualified_shortlist.auto_trigger': {
    description: 'Qualified Shortlist: automatically generate the customer shortlist after enough interested provider responses.',
    owner: 'prod',
    defaultValue: false,
  },
  // ─── Auth ────────────────────────────────────────────────────────────────────
  'auth.otp.whatsapp': {
    description: 'Deliver Supabase Auth OTPs via WhatsApp template instead of SMS. Real kill switch is the Supabase Send SMS Hook URL in the dashboard.',
    owner: 'eng',
    defaultValue: false,
  },
  'security.otp.report': {
    description: 'Enable unrequested OTP report tokens, report routes, security challenge tracking, locks and step-up.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.security.otp': {
    description: 'Enable OTP security admin mutations: acknowledge, resolve, false-positive and clear account lock.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Customer features ───────────────────────────────────────────────────────
  'feature.customer.address_book': {
    description: 'Enable multi-site address book for customers (M1-T4/T5).',
    owner: 'prod',
    defaultValue: false,
  },
  'feature.customer.provider_browse': {
    description: 'Enable public provider catalogue browsing on customer PWA (M6).',
    owner: 'prod',
    defaultValue: false,
  },
  'feature.customer.operator_member': {
    description: 'M1-T8: CustomerMember operator delegation - session resolves to the principal customer account (B2B team booking).',
    owner: 'prod',
    defaultValue: false,
  },
  'feature.customer.auto_assign_on_submit': {
    description: 'When enabled, customer PWA job submissions use AUTO_ASSIGN mode for immediate matching.',
    owner: 'prod',
    defaultValue: false,
  },
  'customer.messaging.v1': {
    description: 'Enable in-app messaging between customer and provider (read + write via WhatsApp relay).',
    owner: 'prod',
    defaultValue: false,
  },
  'customer.realtime.v1': {
    description: 'Enable Supabase Realtime subscription for customer request/booking pages (Phase B).',
    owner: 'eng',
    defaultValue: false,
  },
  // ─── Provider features ───────────────────────────────────────────────────────
  'feature.provider.pwa_inbox': {
    description: 'Enable provider PWA lead inbox, profile editor, availability toggle and earnings dashboard (M4).',
    owner: 'prod',
    defaultValue: false,
  },
  'provider.onboarding.auto_approve': {
    description: 'Enable cron-based auto-approval of standard (non-high-risk) provider applications.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Matching engine ─────────────────────────────────────────────────────────
  'matching.v2.candidate_pool': {
    description: 'Use precomputed candidate pool in the matching orchestrator instead of a live DB scan. Speeds up dispatch and reduces query load.',
    owner: 'eng',
    defaultValue: false,
  },


  // ─── Pilot - post-job review flow ────────────────────────────────────────────
  'pilot.completion-check': {
    description: 'Enable cron-driven completion-check WhatsApp flow for AUTO_ASSIGN cash-pilot jobs. Sends completion check 2 days after job window; fires review nudges on Yes.',
    owner: 'ops',
    defaultValue: false,
  },

  // ─── Identity verification ───────────────────────────────────────────────────
  'provider.identity.verification': {
    description: 'Gate paid credit purchases (Pay@, Payfast, Manual EFT) behind HIGH-assurance identity verification. Disable to roll back without a deploy.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.verification.automation': {
    description: 'Enable provider-agnostic automated identity verification submission after document and selfie capture.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.verification.fail_safe': {
    description: 'Enable shared identity-verification start gating: resume active attempts, cap repeated failures and preserve credit-purpose HIGH assurance.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.verification.pilot_allowlist_required': {
    description: 'When ON (default), only providers in provider_identity_verification_pilot_allowlist get the active identity-verification vendor; others fall through to manual review. Flip to OFF to remove the pilot gate and route every provider that matches the automation + vendor gates to the active vendor (general availability).',
    owner: 'eng',
    defaultValue: true,
  },
  'provider.identity.verification.liveness.degraded_kill_switch': {
    description: 'Fail closed when liveness provider sessions are degraded; affected cases route to manual review.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.verification.freeze_vendor_verdicts': {
    description: 'Store vendor webhooks but route all automated verdicts to manual review during vendor accuracy or integrity incidents.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.crud.verifications': {
    description: 'Enable admin identity-verification review queue: view docs, approve/reject/request-retry. Requires TRUST or higher.',
    owner: 'ops',
    defaultValue: false,
  },
  'provider.identity.vendor.omnicheck': {
    description: 'Enable OmniCheck/VerifyID as a live identity verification vendor (P2 - sandbox only until contract signed).',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.vendor.datanamix': {
    description: 'Enable Datanamix/pbVerify as a live identity verification vendor (P2 - sandbox only until contract signed).',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.vendor.smile_id': {
    description: 'Enable Smile ID as a live identity verification vendor for foreign-national passport paths (P3).',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.vendor.didit': {
    description: 'Enable Didit as a hosted-flow identity verification vendor (KYC + liveness + AML + optional SA DHA). Default workflow is KYC_AUTHORITATIVE for provider onboarding.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.vendor.didit.persist_documents': {
    description: 'Persist Didit decision fields and private document images after terminal vendor verdicts or admin backfills.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.commercial.economics.didit_scenario': {
    description: 'Show the Didit onboarding-vendor scenario on the Provider Economics dashboard (companion to provider.identity.vendor.didit).',
    owner: 'ops',
    defaultValue: false,
  },
  'provider.identity.vendor.thisisme': {
    description: 'Enable ThisIsMe NIIS as a live identity verification vendor for refugee/asylum-seeker paths (P3).',
    owner: 'eng',
    defaultValue: false,
  },
  // ─── Vouchers ────────────────────────────────────────────────────────────────
  'admin.vouchers': {
    description: 'Enable the admin Vouchers page and cancel-voucher mutation.',
    owner: 'ops',
    defaultValue: false,
  },

  // ─── WhatsApp registration friction fixes (2026-06-04) ──────────────────────
  'whatsapp.registration.name_profile_shortcut': {
    description: 'Offer the WhatsApp profile name as a one-tap default at the reg_collect_name step, plus a short privacy framing line.',
    owner: 'prod',
    defaultValue: false,
  },
  'whatsapp.registration.deeplink': {
    description: 'Detect ad-driven prefilled-message tokens and jump straight into reg_start, bypassing the welcome menu.',
    owner: 'prod',
    defaultValue: false,
  },
  'whatsapp.registration.evidence_skip_primary': {
    description: 'Show "Skip for now" as the primary (first) button on the evidence step for non-high-risk skills; send a 24h upload-later follow-up.',
    owner: 'prod',
    defaultValue: false,
  },
  'whatsapp.flow_switch_data_clear': {
    description: 'On Conversation.flow change, strip data keys not whitelisted for the target flow. Prevents customer-flow keys polluting registration sessions.',
    owner: 'eng',
    defaultValue: false,
  },
  'whatsapp.session_prewarning': {
    description: 'Send a pre-expiry "continue where you left off" message ~5 min before Conversation.expiresAt for mid-flow sessions.',
    owner: 'prod',
    defaultValue: false,
  },
  'whatsapp.recovery.template_send': {
    description: 'Allow provider onboarding recovery sends outside the 23h WhatsApp session window by using approved WABA recovery templates.',
    owner: 'eng',
    defaultValue: false,
  },

  // ─── Campaign / marketing ────────────────────────────────────────────────────
  'feature.deadlineed.b2b_landing': {
    description: 'Enable B2B variant of landing page copy for the Deadlineed campaign.',
    owner: 'prod',
    defaultValue: false,
  },
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS_REGISTRY
