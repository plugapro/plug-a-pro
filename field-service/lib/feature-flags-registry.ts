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
  'whatsapp.recovery.template_send': {
    description: 'Enable WhatsApp onboarding recovery outside the 23h session window using approved provider recovery templates.',
    owner: 'eng',
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
  'customer.home.serviceability_v2': {
    description: 'Constrain customer PWA home search to active skills for the selected area, scope the active-providers count card to area + selected skill, and reject unsupported area/skill combinations at the request-creation API.',
    owner: 'prod',
    defaultValue: false,
  },
  'customer.home.notify_interest': {
    description: 'Turn unavailable home category tiles into a "Coming soon — notify me" capture: tapping one opens a WhatsApp-number sheet that records demand via the service-area waitlist (requires customer.home.serviceability_v2 to mark tiles unavailable).',
    owner: 'prod',
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
  'provider.auto_approve.enabled': {
    description: 'Kill switch enforced inside autoApproveProviderApplications(): when disabled (default), the function returns early and never sets provider active/verified/ACTIVE. Field-completeness checks alone must never promote a provider without this flag — manual admin review is unaffected.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Matching engine ─────────────────────────────────────────────────────────
  'matching.v2.candidate_pool': {
    description: 'Use precomputed candidate pool in the matching orchestrator instead of a live DB scan. Speeds up dispatch and reduces query load.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.quality.uplift': {
    description: 'Provider Quality Uplift admin view + nudge orchestrator (lib/provider-quality/). When OFF, dry-run preview still works but sendNudges short-circuits with FEATURE_DISABLED. Flip ON per env after the Meta-approved templates (provider_profile_photo_nudge, provider_evidence_nudge, provider_high_risk_cert_nudge, provider_quality_multi_nudge) land in WhatsApp Business.',
    owner: 'ops',
    defaultValue: false,
  },
  'matching.verification_trust_tier': {
    description: 'Hard-tier candidate ranking by KYC verification: kycStatus=VERIFIED providers sort above all others within the same eligible pool, then by score; non-verified ranked by score among themselves. Keeps the legacy grace flag honest (non-verified still match) but ensures truly lead-eligible providers get the first response window. Default OFF — flip on per environment after smoke-testing.',
    owner: 'eng',
    defaultValue: false,
  },

  // ─── Launch - West Rand pilot rollout ───────────────────────────────────────
  'launch.west_rand_pilot.enabled': {
    description: 'Master toggle for the West Rand pilot. When ON, customer serviceability + bookings + dispatch are gated to the pilot suburb / category allowlists in lib/launch/west-rand-pilot.ts. When OFF, legacy behaviour is preserved.',
    owner: 'eng',
    defaultValue: false,
  },
  'matching.kyc_grace_legacy_providers': {
    description: 'Scoped, time-boxed KYC grace. When ON, providers created before KYC_GRACE_CUTOFF (lib/matching/kyc-grace.ts) are eligible for matching AND lead-unlock WITHOUT kycStatus=VERIFIED; providers created after the cutoff always require real KYC. Default ON so the live marketplace keeps working (the provider base was ~97% non-KYC when enforcement landed). Retire (set OFF) once the legacy cohort completes KYC.',
    owner: 'eng',
    defaultValue: true,
  },
  'provider.kyc.required_for_activation': {
    description: 'Mandatory KYC gate at the *approval* boundary. When ON, syncProviderRecord refuses to flip verified=true / status=ACTIVE unless the provider is kycStatus=VERIFIED, has an admin override, or is within a per-provider kycGraceUntil window. Same rule guards admin verify/setStatus(ACTIVE)/approveApplication and autoApproveProviderApplications. Default OFF so the flag can be flipped in DB per environment after the backfill (scripts/backfill-kyc-grace-windows.ts). REQUIRE_PROVIDER_KYC=true|false env var overrides the flag (env wins). Existing legacy providers (created before KYC_GRACE_CUTOFF) stay grandfathered while matching.kyc_grace_legacy_providers is ON.',
    owner: 'eng',
    defaultValue: false,
  },
  'launch.west_rand_pilot.electrical_gate': {
    description: 'Independent gate for the electrical-readiness check. Dead path in v1 (electrical is not in the pilot allowlist); reserved for the future re-introduction of Electrical once threshold approved providers exist.',
    owner: 'eng',
    defaultValue: false,
  },
  'launch.west_rand_pilot.readiness_report': {
    description: 'Shows /admin/launch-readiness. Can be enabled to ops independently of the customer-facing master flag so counts can be validated before customer activation.',
    owner: 'eng',
    defaultValue: false,
  },
  'launch.west_rand_pilot.nudge_console': {
    description: 'Shows /admin/nudges (ordered candidate queue + per-row preview + CSV export + mark-batch-sent). No outbound Meta WhatsApp API in this scope; ops sends externally and marks the batch sent for audit purposes.',
    owner: 'eng',
    defaultValue: false,
  },

  // ─── Ops Agent Workflow Team ─────────────────────────────────────────────────
  'admin.ops_intelligence': {
    description: 'Shows /admin/ops-intelligence (agent recommendations, incomplete profiles, friction & matching alerts, drafts awaiting approval). Internal-only: agents create WhatsApp drafts but never send; ops approves/rejects/resolves. Gates the page, nav entry, and the ops-agents cron.',
    owner: 'ops',
    defaultValue: false,
  },

  // ─── Pilot - post-job review flow ────────────────────────────────────────────
  'pilot.completion-check': {
    description: 'Enable cron-driven completion-check WhatsApp flow for AUTO_ASSIGN cash-pilot jobs. Sends completion check 2 days after job window; fires review nudges on Yes.',
    owner: 'ops',
    defaultValue: false,
  },

  // ─── Identity verification ───────────────────────────────────────────────────
  'kyc_drive.auto_nudge': {
    description: 'Enable automated provider_kyc_nudge WhatsApp sends from the kyc-drive-nudge cron (legacy pre-cutoff providers only). OFF = the cron is report-only.',
    owner: 'eng',
    defaultValue: false,
  },
  'customer.match_confirmation_nudge.cron': {
    description: 'Enable the customer-match-confirmation-nudge cron — sends please_confirm_with_provider to MATCHED customers who have not been contacted, when their 24h WhatsApp window is closed. OFF = the cron is a no-op.',
    owner: 'eng',
    defaultValue: false,
  },
  'customer.abandoned_recovery.cron': {
    description: 'Enable the customer-abandoned-recovery cron — sends customer_abandoned_recovery to phones that started a job_request flow and dropped mid-way (4h-7d ago). OFF = the cron is a no-op. Keep OFF until the customer_abandoned_recovery Meta template is APPROVED.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.identity.verification': {
    description: 'Gate paid credit purchases (Pay@, Manual EFT) behind HIGH-assurance identity verification. Disable to roll back without a deploy.',
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
  'provider.identity.verification.channel_aware_completion': {
    description: 'Render the identity verification completion CTA based on the verification.channel (PWA / WHATSAPP / ADMIN / VENDOR) instead of the legacy WhatsApp-only deeplink. Disable to roll back to the pre-fix behaviour without a deploy.',
    owner: 'eng',
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
  'provider.kyc_selfie_as_avatar': {
    description: 'When ON, approving a KYC identity verification will copy the provider\'s KYC selfie to Provider.avatarUrl when no avatar exists. Enable only after adding a provider consent step to the KYC flow. Default OFF to prevent publishing biometric data as public profile photos without explicit consent.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.kyc.promote_in_channel_captures': {
    description: 'When ON, approving a ProviderApplication that already carries WhatsApp in-channel KYC captures (idNumber + ID document + selfie attachments) will create a ProviderIdentityVerification row in SUBMITTED status so the admin identity-review queue can act on it. Default OFF; turn ON only after the admin review queue is live and you want WhatsApp-captured data to flow into it.',
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
  // ─── Campaign / marketing ────────────────────────────────────────────────────
  'feature.deadlineed.b2b_landing': {
    description: 'Enable B2B variant of landing page copy for the Deadlineed campaign.',
    owner: 'prod',
    defaultValue: false,
  },
  // ─── Provider registration recovery ──────────────────────────────────────────
  'admin.applications.resume_link_button': {
    description: 'Show the per-row "Generate resume link" button on /admin/applications. Issues a ProviderResumeToken and returns a /provider/signup URL for the operator to share.',
    owner: 'ops',
    defaultValue: false,
  },
  'whatsapp.registration.web_resume': {
    description: 'Enable the anonymous /provider/signup?t=… page that resumes a registration from a ProviderResumeToken.',
    owner: 'prod',
    defaultValue: false,
  },
  // ─── Operational digests ─────────────────────────────────────────────────────
  'ops.daily_snapshot_whatsapp_digest': {
    description: 'Send the daily provider snapshot as a WhatsApp digest to ADMIN_WHATSAPP_NUMBER after the cron persists the snapshot row. Default off until Meta approves the admin_daily_provider_snapshot Utility template. Send failures are caught and logged — they do not affect snapshot persistence.',
    owner: 'ops',
    defaultValue: false,
  },
  'admin.applications.redesign_v2': {
    description: 'Render the redesigned /admin/applications worklist (queue strip, priority buckets, compact rows, side drawer) instead of the legacy section-based layout. Read-only UI change — all mutations continue to flow through the existing crudAction() server actions.',
    owner: 'ops',
    defaultValue: false,
  },
  // ─── Matching / dispatch diagnostics ─────────────────────────────────────────
  'admin.providers.legacy_tsa_warning': {
    description: 'On the /admin/technicians/[id] profile, show a warning banner when Provider.serviceAreas[] is non-empty but the provider has zero active TechnicianServiceArea rows. Diagnoses providers stranded on the legacy string-array form whose coverage no longer reaches the structured matching tier.',
    owner: 'eng',
    defaultValue: false,
  },
  'admin.dispatch.coverage_tier_badge': {
    description: 'On the /admin/dispatch activity feed, render a coverage-tier badge (RADIUS / SUBURB_EXACT / REGION_FALLBACK / LEGACY_STRING / NO_MATCH) next to OUTSIDE_SERVICE_AREA filter reasons, so operators can tell whether a provider missed by structured node, region fallback, or absent coverage entirely.',
    owner: 'eng',
    defaultValue: false,
  },
  'provider.onboarding.recovery_auto_nudge': {
    description: 'Allow the /api/cron/provider-onboarding-recovery schedule to auto-send WhatsApp onboarding recovery nudges. Default off: when disabled the cron only reports the queue and admins send nudges manually from /admin/applications. Sends are additionally scoped to phones with real provider-registration intent.',
    owner: 'ops',
    defaultValue: false,
  },
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS_REGISTRY
