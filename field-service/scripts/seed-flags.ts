/**
 * seed-flags.ts
 *
 * Upserts all admin CRUD feature flags to their default values.
 * Run once after deploying the FeatureFlag migration:
 *
 *   npx tsx scripts/seed-flags.ts
 *
 * Pass --enable to enable all flags (production rollout):
 *   npx tsx scripts/seed-flags.ts --enable
 *
 * Pass --flag=<key> --enable to enable a single flag:
 *   npx tsx scripts/seed-flags.ts --flag=admin.crud.locations --enable
 */

import { setFlag } from '../lib/flags'
import { db } from '../lib/db'

const FLAGS: Array<{ key: string; description: string }> = [
  {
    key: 'admin.crud.locations',
    description: 'Enable create/update/delete mutations on the Location Taxonomy admin page.',
  },
  {
    key: 'admin.crud.customers',
    description: 'Enable block/suspend/archive mutations on the Customers admin page.',
  },
  {
    key: 'admin.crud.providers',
    description: 'Enable verification/suspension mutations on the Providers admin page.',
  },
  {
    key: 'admin.crud.bookings',
    description: 'Enable booking cancellation and payment mutations on the Booking detail admin page.',
  },
  {
    key: 'admin.crud.payments',
    description: 'Enable payment queue claim and refund mutations on the Payments admin page.',
  },
  {
    key: 'admin.crud.disputes',
    description: 'Enable dispute queue claim and resolution mutations on the Disputes admin page.',
  },
  {
    key: 'admin.crud.applications',
    description: 'Enable provider application claim/approve/reject mutations on the Applications admin page.',
  },
  {
    key: 'admin.crud.quotes',
    description: 'Enable quote queue claim/release mutations on the Quote Approvals admin page.',
  },
  {
    key: 'admin.crud.dispatch',
    description: 'Enable dispatch claim, rerank, auto-assign, and override mutations on the Dispatch console.',
  },
  {
    key: 'admin.crud.validation',
    description: 'Enable validation queue claim, release, promote, and cancel mutations on the Validation Queue admin page.',
  },
  {
    key: 'admin.crud.field_exceptions',
    description: 'Enable field exception claim and release mutations on the Field Exceptions admin page.',
  },
  {
    key: 'admin.crud.categories',
    description: 'Enable DB-backed category config mutations on the Categories admin page.',
  },
  {
    key: 'admin.categories.risk_tier',
    description: 'Enable riskTier column and inline LOW/STANDARD selector on the Categories admin page.',
  },
  {
    key: 'admin.users.v2',
    description: 'Enable DB-backed AdminUser team management (invite, role change, deactivate).',
  },
  {
    key: 'admin.crud.messages',
    description: 'Enable failed message retry mutations on the Messages admin page.',
  },
  {
    key: 'ops.v2.cases',
    description: 'Case lifecycle: claim, note, resolve, and reopen exception cases across all ops queues.',
  },
  {
    key: 'qualified_shortlist.dispatch_v2',
    description: 'Qualified Shortlist: send free I\'m interested / Not interested buttons on dispatch instead of legacy paid Accept Lead buttons.',
  },
  {
    key: 'qualified_shortlist.auto_trigger',
    description: 'Qualified Shortlist: automatically generate the customer shortlist after enough interested provider responses.',
  },
  {
    key: 'feature.customer.address_book',
    description: 'Enable multi-site address book for customers (M1-T4/T5).',
  },
  {
    key: 'feature.deadlineed.b2b_landing',
    description: 'Enable B2B variant of landing page copy for the Deadlineed campaign.',
  },
  {
    key: 'feature.provider.pwa_inbox',
    description: 'Enable provider PWA lead inbox, profile editor, availability toggle, and earnings dashboard (M4).',
  },
  {
    key: 'feature.customer.provider_browse',
    description: 'Enable public provider catalogue browsing on customer PWA (M6).',
  },
  {
    key: 'provider.onboarding.auto_approve',
    description: 'Enable cron-based auto-approval of standard (non-high-risk) provider applications. When disabled, all applications queue for manual admin review only.',
  },
  {
    key: 'provider.identity.verification',
    description: 'Enable provider identity verification and paid-credit purchase gating.',
  },
  {
    key: 'admin.crud.verifications',
    description: 'Enable admin identity-verification review queue mutations.',
  },
  {
    key: 'provider.identity.vendor.omnicheck',
    description: 'Enable OmniCheck/VerifyID identity verification adapter.',
  },
  {
    key: 'provider.identity.vendor.datanamix',
    description: 'Enable Datanamix/pbVerify identity verification adapter.',
  },
  {
    key: 'provider.identity.vendor.smile_id',
    description: 'Enable Smile ID identity verification adapter for foreign-national paths.',
  },
  {
    key: 'provider.identity.vendor.thisisme',
    description: 'Enable ThisIsMe identity verification adapter for refugee/asylum paths.',
  },
  {
    key: 'feature.customer.operator_member',
    description: 'M1-T8: CustomerMember operator delegation — when enabled, a session whose phone/userId matches an active CustomerMember record resolves to the principal customer account (B2B team booking).',
  },
  {
    key: 'customer.messaging.v1',
    description: 'Enable in-app messaging between customer and provider (read + write via WhatsApp relay).',
  },
  {
    key: 'customer.realtime.v1',
    description: 'Enable Supabase Realtime subscription for customer request/booking pages (Phase B). Falls back to polling when disabled.',
  },
  {
    key: 'admin.quotes.send',
    description: 'Enable approve, decline, send, and revise admin mutations on the Quote Approvals page (WS-6a hardening). Default off — enable per env after notifyQuoteReady() is wired.',
  },
  {
    key: 'admin.invoices.actions',
    description: 'Enable generate, send, and void mutations on the Invoices admin page.',
  },
  {
    key: 'admin.messages.outbound',
    description: 'Enable admin-initiated outbound WhatsApp sends and broadcast queuing. Capped at BROADCAST_MAX_RECIPIENTS (default 50). Default off — enable per env after reviewing recipient safety caps.',
  },
  {
    key: 'admin.payments.retry',
    description: 'Enable payment PSP checkout retry on the Payments admin page. Reserved — not yet implemented (requires PSP idempotency probe). Default off.',
  },
  {
    key: 'admin.customers.whatsapp_pref_toggle',
    description: 'Enable admin toggle of customer WhatsApp service and marketing opt-in preferences on the Customer detail admin page.',
  },
  {
    key: 'auth.otp.whatsapp',
    description: 'Deliver Supabase Auth OTPs via WhatsApp template instead of SMS. Real kill switch is the Supabase Send SMS Hook URL in the dashboard; this flag is a code-level safety gate. Default off — enable per env after the Meta otp_login template is approved and the hook is wired.',
  },
  {
    key: 'feature.customer.auto_assign_on_submit',
    description: 'When enabled, customer PWA job submissions use AUTO_ASSIGN mode for immediate matching. When disabled, submissions use OPS_REVIEW for manual approval.',
  },
  {
    key: 'pilot.completion-check',
    description: 'Enable cron-driven completion-check WhatsApp flow for AUTO_ASSIGN cash-pilot jobs. Sends completion check 2 days after job window; fires review nudges on Yes.',
  },
  {
    key: 'admin.vouchers',
    description: 'Admin voucher batch management — pilot provider credit vouchers',
  },
]

async function main() {
  const args = process.argv.slice(2)
  const enableAll = args.includes('--enable') && !args.some((a) => a.startsWith('--flag='))
  const targetFlag = args.find((a) => a.startsWith('--flag='))?.slice('--flag='.length)
  const enableTarget = args.includes('--enable')

  const targets = targetFlag
    ? FLAGS.filter((f) => f.key === targetFlag)
    : FLAGS

  if (targetFlag && targets.length === 0) {
    console.error(`Unknown flag: ${targetFlag}`)
    console.error(`Known flags:\n${FLAGS.map((f) => `  ${f.key}`).join('\n')}`)
    process.exit(1)
  }

  console.log(`Seeding ${targets.length} feature flag(s)…`)

  for (const flag of targets) {
    const enabled = targetFlag ? enableTarget : enableAll
    await setFlag(flag.key, { enabled, description: flag.description })
    console.log(`  ${enabled ? '✓ enabled ' : '○ disabled'} ${flag.key}`)
  }

  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
