// Safe, idempotent seed script — West Rand pilot test leads.
// Creates customers, addresses, job requests, image attachments, and a full
// DispatchDecision → MatchAttempt → AssignmentHold → Lead chain for Fannie.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --dry-run
//   ALLOW_TEST_DATA_IMPORT=true npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --commit
//   ALLOW_TEST_DATA_IMPORT=true npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --commit --requests-only
//
// Flags:
//   --dry-run            Print plan without writing (default)
//   --commit             Write to DB (requires ALLOW_TEST_DATA_IMPORT=true)
//   --reset-existing     On re-run, extend expiry of existing SENT leads
//   --requests-only      Create customers + job requests only; skip lead chain creation
//                        (use when you want to trigger dispatch via the admin panel instead)
//   --image-dir=<path>   Override source image folder
//   --send-whatsapp=true Intentionally unsupported; script throws if supplied

import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { put } from '@vercel/blob'
import { db } from '../lib/db'
import { creditPromoCreditsInTransaction } from '../lib/provider-wallet'
import {
  createProviderLeadAccessToken,
  LEAD_RESPONSE_SCOPES,
} from '../lib/provider-lead-access'
import {
  COHORT,
  CUSTOMERS,
  IMAGE_MAPPING,
  PROVIDER_NAME_FRAGMENT,
  MIN_PROMO_CREDITS,
  TOP_UP_PROMO_CREDITS,
  LEAD_TTL_MINUTES,
  REQUEST_EXPIRES_DAYS,
  type CustomerConfig,
  type AddressConfig,
  type ImageMappingEntry,
} from './seed-west-rand-test-leads.config'

// ─── Phone normalization ──────────────────────────────────────────────────────

export function normalisePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '')

  // Already E.164 with +27
  if (/^\+27\d{9}$/.test(stripped)) return stripped

  // 27xxxxxxxxx → +27...
  if (/^27\d{9}$/.test(stripped)) return `+${stripped}`

  // 0xxxxxxxxx → +27...
  if (/^0\d{9}$/.test(stripped)) return `+27${stripped.slice(1)}`

  if (/^\+[^2]|^\+2[^7]/.test(stripped)) {
    throw new Error(`Not a South African number: ${raw}`)
  }

  throw new Error(`Cannot normalise phone number: ${raw}`)
}

// ─── Image classification ─────────────────────────────────────────────────────

export interface ClassifiedImage {
  filename: string
  baseName: string
  ext: string
  customerKey: string
  entry: ImageMappingEntry
}

export interface ClassificationResult {
  classified: ClassifiedImage[]
  needsReview: string[]
}

export function classifyImages(
  filenames: string[],
  mapping: Record<string, ImageMappingEntry>,
): ClassificationResult {
  const classified: ClassifiedImage[] = []
  const needsReview: string[] = []

  for (const filename of filenames) {
    const dotIndex = filename.lastIndexOf('.')
    const baseName = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename
    const ext = dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : ''
    const entry = mapping[baseName]
    if (entry) {
      classified.push({ filename, baseName, ext, customerKey: entry.customerKey, entry })
    } else {
      needsReview.push(filename)
    }
  }

  return { classified, needsReview }
}

// ─── Availability window ──────────────────────────────────────────────────────

export function buildAvailabilityWindow(
  availability: 'urgent' | 'mornings' | 'flexible',
  now = new Date(),
): { start: Date; end: Date } {
  const SAST_OFFSET_MS = 2 * 3600_000 // UTC+2

  function nextDayAt(daysFromNow: number, hourSAST: number): Date {
    const d = new Date(now.getTime() + daysFromNow * 86_400_000)
    d.setUTCHours(0, 0, 0, 0)
    return new Date(d.getTime() - SAST_OFFSET_MS + hourSAST * 3600_000)
  }

  if (availability === 'urgent') {
    return {
      start: new Date(now.getTime() + 2 * 3600_000),
      end: new Date(now.getTime() + 4 * 3600_000),
    }
  }

  if (availability === 'mornings') {
    return { start: nextDayAt(1, 7), end: nextDayAt(1, 12) }
  }

  // flexible
  return { start: nextDayAt(2, 7), end: nextDayAt(2, 17) }
}

// ─── Customer upsert ──────────────────────────────────────────────────────────

export interface UpsertCustomerResult {
  customer: { id: string; phone: string; name: string } | null
  created: boolean
}

export async function upsertCustomer(
  config: CustomerConfig,
  commit: boolean,
): Promise<UpsertCustomerResult> {
  const phone = normalisePhone(config.phone)
  const existing = await db.customer.findUnique({ where: { phone } })
  if (existing) return { customer: existing, created: false }
  if (!commit) return { customer: null, created: false }

  const customer = await db.customer.create({
    data: {
      phone,
      name: config.name,
      isTestUser: true,
      cohortName: COHORT,
      channel: 'PWA',
      active: true,
      whatsappServiceOptIn: false,
      whatsappMarketingOptIn: false,
      notes: `[TEST SEED] ${COHORT}`,
    },
  })

  return { customer, created: true }
}

// ─── Address upsert ───────────────────────────────────────────────────────────

export interface UpsertAddressResult {
  address: { id: string } | null
  created: boolean
}

export async function upsertAddress(
  customerId: string,
  config: AddressConfig,
  commit: boolean,
): Promise<UpsertAddressResult> {
  const existing = await db.address.findFirst({
    where: { customerId, street: config.street, suburb: config.suburb },
  })
  if (existing) return { address: existing, created: false }
  if (!commit) return { address: null, created: false }

  const address = await db.address.create({
    data: {
      customerId,
      label: config.label,
      street: config.street,
      suburb: config.suburb,
      city: config.city,
      province: config.province,
      postalCode: config.postalCode,
      lat: config.lat,
      lng: config.lng,
      isDefault: true,
    },
  })

  return { address, created: true }
}

// ─── JobRequest upsert ────────────────────────────────────────────────────────

export interface UpsertJobRequestResult {
  jobRequest: { id: string; status: string } | null
  created: boolean
}

export async function upsertJobRequest(
  customer: { id: string; phone: string; name: string },
  address: { id: string } | null,
  config: CustomerConfig,
  commit: boolean,
): Promise<UpsertJobRequestResult> {
  const existing = await db.jobRequest.findFirst({
    where: { customerId: customer.id, cohortName: COHORT, category: config.category },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { jobRequest: existing, created: false }
  if (!commit) return { jobRequest: null, created: false }

  const now = new Date()
  const window = buildAvailabilityWindow(config.availability, now)

  const jobRequest = await db.jobRequest.create({
    data: {
      customerId: customer.id,
      addressId: address?.id ?? null,
      category: config.category,
      title: config.title,
      description: config.description,
      requestedWindowStart: window.start,
      requestedWindowEnd: window.end,
      status: 'MATCHING',
      assignmentMode: 'AUTO_ASSIGN',
      isTestRequest: true,
      cohortName: COHORT,
      expiresAt: new Date(now.getTime() + REQUEST_EXPIRES_DAYS * 86_400_000),
    },
  })

  return { jobRequest, created: true }
}

// ─── Image upload + attachment ────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
}

export async function uploadAndAttach(params: {
  jobRequestId: string
  imagePath: string
  label: string
  caption: string | null
  uploadedBy: string
  commit: boolean
}): Promise<{ id: string } | null> {
  const { jobRequestId, imagePath, label, caption, uploadedBy, commit } = params
  if (!commit) return null

  const ext = extname(imagePath).replace('.', '').toLowerCase()
  const mimeType = MIME_MAP[ext] ?? 'image/jpeg'
  const buffer = readFileSync(imagePath)
  const sizeBytes = statSync(imagePath).size
  const blobKey = `job-requests/${jobRequestId}/${Date.now()}-${label}.${ext}`

  const blob = await put(blobKey, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: mimeType,
  })

  const attachment = await db.attachment.create({
    data: {
      jobRequestId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType,
      sizeBytes,
      label,
      caption: caption ?? null,
      uploadedBy,
    },
  })

  return attachment
}

// ─── Lead chain creation ──────────────────────────────────────────────────────

export interface LeadChainResult {
  leadId: string
  holdId: string
  dispatchDecisionId: string
  matchAttemptId: string
  alreadyExisted: boolean
}

export async function createLeadChain(params: {
  jobRequestId: string
  provider: { id: string; phone: string; name: string }
  commit: boolean
  resetExisting?: boolean
}): Promise<LeadChainResult | null> {
  const { jobRequestId, provider, commit, resetExisting = false } = params

  const existingLead = await db.lead.findUnique({
    where: { jobRequestId_providerId: { jobRequestId, providerId: provider.id } },
  })

  if (existingLead && !resetExisting) {
    if (
      existingLead.assignmentHoldId &&
      existingLead.matchAttemptId &&
      existingLead.dispatchDecisionId
    ) {
      return {
        leadId: existingLead.id,
        holdId: existingLead.assignmentHoldId,
        dispatchDecisionId: existingLead.dispatchDecisionId,
        matchAttemptId: existingLead.matchAttemptId,
        alreadyExisted: true,
      }
    }
  }

  if (!commit) return null

  const now = new Date()
  const expiresAt = new Date(now.getTime() + LEAD_TTL_MINUTES * 60_000)

  const decision = await db.dispatchDecision.create({
    data: {
      jobRequestId,
      mode: 'AUTO_ASSIGN',
      status: 'OFFERING',
      initiatedById: 'system:seed-script',
      initiatedByRole: 'system',
      selectedProviderId: provider.id,
      consideredCount: 1,
      eligibleCount: 1,
      scoreWeights: {},
      rankingSummary: { source: 'seed-script', candidateCount: 1 },
      filterSummary: {},
      explanation: `Test seed — ${COHORT}`,
    },
  })

  const attempt = await db.matchAttempt.create({
    data: {
      jobRequestId,
      providerId: provider.id,
      dispatchDecisionId: decision.id,
      attemptNumber: 1,
      rankedPosition: 1,
      stage: 'OFFERED',
      hardFilterPassed: true,
      score: 1.0,
      scoreBreakdown: { source: 'seed-script' },
      offeredAt: now,
    },
  })

  await db.dispatchDecision.update({
    where: { id: decision.id },
    data: { selectedMatchAttemptId: attempt.id },
  })

  await db.assignmentHold.updateMany({
    where: { jobRequestId, providerId: provider.id, status: 'ACTIVE' },
    data: { status: 'RELEASED', outcomeReasonCode: 'SUPERSEDED_BY_SEED', releasedAt: now },
  })

  const hold = await db.assignmentHold.create({
    data: {
      jobRequestId,
      providerId: provider.id,
      dispatchDecisionId: decision.id,
      matchAttemptId: attempt.id,
      status: 'ACTIVE',
      offeredAt: now,
      expiresAt,
    },
  })

  const lead = await db.lead.upsert({
    where: { jobRequestId_providerId: { jobRequestId, providerId: provider.id } },
    create: {
      jobRequestId,
      providerId: provider.id,
      dispatchDecisionId: decision.id,
      matchAttemptId: attempt.id,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: now,
      expiresAt,
      isTestLead: true,
      cohortName: COHORT,
    },
    update: {
      dispatchDecisionId: decision.id,
      matchAttemptId: attempt.id,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: now,
      expiresAt,
      respondedAt: null,
    },
  })

  return {
    leadId: lead.id,
    holdId: hold.id,
    dispatchDecisionId: decision.id,
    matchAttemptId: attempt.id,
    alreadyExisted: false,
  }
}

// ─── Fannie lookup ────────────────────────────────────────────────────────────

export async function findFannie(nameFragment: string) {
  return db.provider.findFirst({
    where: {
      name: { contains: nameFragment, mode: 'insensitive' },
      active: true,
    },
  })
}

// ─── Credit top-up ────────────────────────────────────────────────────────────

export interface EnsureCreditsResult {
  toppedUp: boolean
  creditsAdded: number
  totalBalance: number
}

export async function ensureFannieHasCredits(
  providerId: string,
  minCredits: number,
  topUpCredits: number,
  commit: boolean,
): Promise<EnsureCreditsResult> {
  const wallet = await db.providerWallet.findUnique({ where: { providerId } })
  const total = (wallet?.paidCreditBalance ?? 0) + (wallet?.promoCreditBalance ?? 0)

  if (total >= minCredits) {
    return { toppedUp: false, creditsAdded: 0, totalBalance: total }
  }

  if (!commit) {
    return { toppedUp: false, creditsAdded: 0, totalBalance: total }
  }

  await db.$transaction(async (tx) => {
    await creditPromoCreditsInTransaction(tx, providerId, topUpCredits, {
      referenceType: 'seed-script',
      referenceId: `${COHORT}:promo-topup`,
      description: `Test seed top-up — ${COHORT}`,
      isTestTransaction: true,
      cohortName: COHORT,
      createdBy: 'system:seed-script',
    })
  })

  const updated = await db.providerWallet.findUnique({ where: { providerId } })
  const newTotal = (updated?.paidCreditBalance ?? 0) + (updated?.promoCreditBalance ?? 0)

  return { toppedUp: true, creditsAdded: topUpCredits, totalBalance: newTotal }
}

// ─── Safety guard ─────────────────────────────────────────────────────────────

export function assertSafeToRun(commit: boolean): void {
  if (!commit) return
  if (process.env.ALLOW_TEST_DATA_IMPORT !== 'true') {
    throw new Error(
      'Refusing to write test data: set ALLOW_TEST_DATA_IMPORT=true to proceed.',
    )
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface SeedReport {
  customers: Array<{ name: string; phone: string; id: string | null; created: boolean }>
  addresses: Array<{ customerId: string | null; suburb: string; created: boolean }>
  jobRequests: Array<{ customerId: string | null; category: string; id: string | null; created: boolean }>
  imagesClassified: ClassifiedImage[]
  imagesNeedsReview: string[]
  attachments: Array<{ jobRequestId: string; filename: string; attachmentId: string | null }>
  provider: { id: string | null; name: string | null; creditsAdded: number; totalCredits: number } | null
  leads: Array<{ leadId: string | null; jobRequestId: string; leadUrl: string | null; alreadyExisted: boolean }>
  warnings: string[]
}

export function printReport(report: SeedReport, commit: boolean): void {
  const mode = commit ? '[COMMIT]' : '[DRY-RUN]'
  const line = '─'.repeat(60)
  console.log(`\n${line}`)
  console.log(`Plug A Pro — West Rand Test Seed ${mode}`)
  console.log(`${line}\n`)

  console.log('CUSTOMERS:')
  for (const c of report.customers) {
    const status = c.id
      ? (c.created ? 'created' : 'found')
      : 'would create'
    console.log(`  ${status.padEnd(14)} ${c.name} (${c.phone}) → id=${c.id ?? 'n/a'}`)
  }

  console.log('\nADDRESSES:')
  for (const a of report.addresses) {
    const status = a.created ? 'created' : 'found/skipped'
    console.log(`  ${status.padEnd(14)} ${a.suburb} (customerId=${a.customerId ?? 'n/a'})`)
  }

  console.log('\nJOB REQUESTS:')
  for (const jr of report.jobRequests) {
    const status = jr.id
      ? (jr.created ? 'created' : 'found')
      : 'would create'
    console.log(`  ${status.padEnd(14)} ${jr.category} → id=${jr.id ?? 'n/a'}`)
  }

  console.log('\nIMAGES:')
  console.log(`  classified    ${report.imagesClassified.length}`)
  for (const img of report.imagesClassified) {
    console.log(`    ✓ ${img.filename} → ${img.customerKey} [${img.entry.label}]`)
  }
  if (report.imagesNeedsReview.length > 0) {
    console.log(`  needs_review  ${report.imagesNeedsReview.length}`)
    for (const f of report.imagesNeedsReview) {
      console.log(`    ? ${f}  ← add to IMAGE_MAPPING in config`)
    }
  }

  console.log('\nATTACHMENTS:')
  if (report.attachments.length === 0) {
    console.log('  (none — update IMAGE_MAPPING in config to attach images)')
  }
  for (const att of report.attachments) {
    const status = att.attachmentId ? 'uploaded' : 'would upload'
    console.log(`  ${status.padEnd(14)} ${att.filename} → jobRequest=${att.jobRequestId}`)
  }

  if (report.provider) {
    // Do not print the provider name to stdout — avoid materialising PII in
    // terminal scrollback / CI logs. The id is enough to look the row up.
    console.log('\nPROVIDER:')
    console.log(`  id=${report.provider.id}`)
    console.log(
      `  credits added=${report.provider.creditsAdded}  total balance=${report.provider.totalCredits}`,
    )
  } else {
    console.log('\nPROVIDER: ⚠  provider not found — check PROVIDER_NAME_FRAGMENT in config')
  }

  console.log('\nLEADS:')
  for (const lead of report.leads) {
    if (lead.leadId) {
      const status = lead.alreadyExisted ? 'found' : 'created'
      console.log(`  ${status.padEnd(14)} leadId=${lead.leadId}`)
      // Lead URLs are bearer-style magic links (signed access tokens). Never
      // print them to stdout/CI logs. Look the token up from the lead row or
      // re-issue it through the normal flow when manual testing is needed.
      if (lead.leadUrl) console.log('    URL: [REDACTED_SIGNED_URL]')
    } else {
      console.log(`  would create  jobRequest=${lead.jobRequestId}`)
    }
  }

  if (report.warnings.length > 0) {
    console.log('\nWARNINGS:')
    for (const w of report.warnings) console.log(`  ⚠  ${w}`)
  }

  console.log(`\n${line}\n`)
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const commit = args.includes('--commit') && !args.includes('--dry-run')
  const resetExisting = args.includes('--reset-existing=true')
  const requestsOnly = args.includes('--requests-only')
  const imageDir = (() => {
    const flag = args.find((a) => a.startsWith('--image-dir='))
    return flag ? flag.slice('--image-dir='.length) : '/Users/shimane/Desktop/defects/plugapro/images'
  })()

  if (args.includes('--send-whatsapp=true')) {
    throw new Error(
      'WhatsApp sending is not supported in this seed script. Remove --send-whatsapp=true.',
    )
  }

  assertSafeToRun(commit)

  const appUrl = (
    process.env.PROVIDER_LEAD_APP_URL ||
    process.env.NEXT_PUBLIC_PROVIDER_LEAD_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '')

  console.log(`Mode:          ${commit ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`Requests only: ${requestsOnly ? 'YES — skipping lead chain creation' : 'no'}`)
  console.log(`Image dir:     ${imageDir}`)
  console.log(`App URL:       ${appUrl}`)

  if (
    appUrl === 'http://localhost:3000' &&
    !process.env.PROVIDER_LEAD_APP_URL &&
    !process.env.NEXT_PUBLIC_APP_URL
  ) {
    console.warn('\n⚠  No app URL configured. Lead URLs will use http://localhost:3000.')
    console.warn('   Set PROVIDER_LEAD_APP_URL or NEXT_PUBLIC_APP_URL for phone-accessible URLs.\n')
  }

  const report: SeedReport = {
    customers: [],
    addresses: [],
    jobRequests: [],
    imagesClassified: [],
    imagesNeedsReview: [],
    attachments: [],
    provider: null,
    leads: [],
    warnings: [],
  }

  // ─── Scan and classify images ─────────────────────────────────────────────
  let imageFiles: string[] = []
  if (existsSync(imageDir)) {
    imageFiles = readdirSync(imageDir).filter((f) =>
      /\.(png|jpg|jpeg|webp|heic)$/i.test(f),
    )
  } else {
    report.warnings.push(`Image folder not found: ${imageDir}`)
  }

  const { classified, needsReview } = classifyImages(imageFiles, IMAGE_MAPPING)
  report.imagesClassified = classified
  report.imagesNeedsReview = needsReview

  if (imageFiles.length > 0 && classified.length === 0) {
    report.warnings.push(
      `${imageFiles.length} images found but IMAGE_MAPPING is empty. ` +
        'View images and add entries to config to attach them.',
    )
  }

  // ─── Copy classified images to staging folder ─────────────────────────────
  if (commit && classified.length > 0) {
    const stagingDir = join(process.cwd(), 'tmp', 'plugapro-test-import', 'images')
    mkdirSync(stagingDir, { recursive: true })
    for (const img of classified) {
      const destName = `${img.customerKey}-${img.entry.label}-${img.baseName.slice(-8).toLowerCase()}.${img.ext}`
      copyFileSync(join(imageDir, img.filename), join(stagingDir, destName))
    }
  }

  // ─── Find the target provider early (needed for lead creation) ────────────
  const fannie = await findFannie(PROVIDER_NAME_FRAGMENT)
  if (!fannie) {
    report.warnings.push(
      `Provider not found: name contains "${PROVIDER_NAME_FRAGMENT}". ` +
        'Set PROVIDER_NAME_FRAGMENT to the target provider name fragment.',
    )
  }

  if (fannie) {
    const creditsResult = await ensureFannieHasCredits(
      fannie.id,
      MIN_PROMO_CREDITS,
      TOP_UP_PROMO_CREDITS,
      commit,
    )
    report.provider = {
      id: fannie.id,
      name: fannie.name,
      creditsAdded: creditsResult.creditsAdded,
      totalCredits: creditsResult.totalBalance,
    }
  }

  // ─── Process each customer ────────────────────────────────────────────────
  const customerContexts: Array<{
    config: (typeof CUSTOMERS)[number]
    customerId: string | null
    addressId: string | null
    jobRequestId: string | null
  }> = []

  for (const config of CUSTOMERS) {
    const custResult = await upsertCustomer(config, commit)
    report.customers.push({
      name: config.name,
      phone: config.phone,
      id: custResult.customer?.id ?? null,
      created: custResult.created,
    })

    let addressId: string | null = null
    if (custResult.customer) {
      const addrResult = await upsertAddress(custResult.customer.id, config.address, commit)
      report.addresses.push({
        customerId: custResult.customer.id,
        suburb: config.address.suburb,
        created: addrResult.created,
      })
      addressId = addrResult.address?.id ?? null
    } else {
      report.addresses.push({ customerId: null, suburb: config.address.suburb, created: false })
    }

    let jobRequestId: string | null = null
    if (custResult.customer) {
      const jrResult = await upsertJobRequest(
        custResult.customer,
        addressId ? { id: addressId } : null,
        config,
        commit,
      )
      report.jobRequests.push({
        customerId: custResult.customer.id,
        category: config.category,
        id: jrResult.jobRequest?.id ?? null,
        created: jrResult.created,
      })
      jobRequestId = jrResult.jobRequest?.id ?? null
    } else {
      report.jobRequests.push({ customerId: null, category: config.category, id: null, created: false })
    }

    customerContexts.push({
      config,
      customerId: custResult.customer?.id ?? null,
      addressId,
      jobRequestId,
    })
  }

  // ─── Upload images ────────────────────────────────────────────────────────
  for (const img of classified) {
    const ctx = customerContexts.find((c) => c.config.key === img.customerKey)
    if (!ctx?.jobRequestId) {
      report.warnings.push(`Skipping image ${img.filename}: no jobRequestId for ${img.customerKey}`)
      report.attachments.push({ jobRequestId: 'n/a', filename: img.filename, attachmentId: null })
      continue
    }

    const existingAtt = await db.attachment.findFirst({
      where: { jobRequestId: ctx.jobRequestId, label: img.entry.label },
    })
    if (existingAtt) {
      report.attachments.push({
        jobRequestId: ctx.jobRequestId,
        filename: img.filename,
        attachmentId: existingAtt.id,
      })
      continue
    }

    const attachment = await uploadAndAttach({
      jobRequestId: ctx.jobRequestId,
      imagePath: join(imageDir, img.filename),
      label: img.entry.label,
      caption: img.entry.caption ?? null,
      uploadedBy: 'system:seed-script',
      commit,
    })

    report.attachments.push({
      jobRequestId: ctx.jobRequestId,
      filename: img.filename,
      attachmentId: attachment?.id ?? null,
    })
  }

  // ─── Create lead chains ───────────────────────────────────────────────────
  if (requestsOnly) {
    console.log('\n⏭  --requests-only: skipping lead chain creation.')
    console.log('   Go to /admin/dispatch and trigger AUTO_ASSIGN (or Manual Override → Fannie)')
    console.log('   to send Fannie a real WhatsApp lead notification.\n')
  }

  if (fannie && !requestsOnly) {
    for (const ctx of customerContexts) {
      if (!ctx.jobRequestId) {
        report.leads.push({ leadId: null, jobRequestId: 'n/a', leadUrl: null, alreadyExisted: false })
        continue
      }

      const chainResult = await createLeadChain({
        jobRequestId: ctx.jobRequestId,
        provider: fannie,
        commit,
        resetExisting,
      })

      let leadUrl: string | null = null
      if (chainResult?.leadId) {
        const token = createProviderLeadAccessToken({
          leadId: chainResult.leadId,
          providerId: fannie.id,
          jobRequestId: ctx.jobRequestId,
          providerPhone: fannie.phone,
          scopes: LEAD_RESPONSE_SCOPES,
          // no expiresAt → uses default 72-hour token TTL
        })
        leadUrl = `${appUrl}/leads/access/${encodeURIComponent(token)}`
      }

      report.leads.push({
        leadId: chainResult?.leadId ?? null,
        jobRequestId: ctx.jobRequestId,
        leadUrl,
        alreadyExisted: chainResult?.alreadyExisted ?? false,
      })
    }
  }

  printReport(report, commit)
  await db.$disconnect()
}

// ─── Entry point ──────────────────────────────────────────────────────────────
if (process.argv[1]?.includes('seed-west-rand-test-leads')) {
  main().catch((err) => {
    console.error('Seed script failed:', err)
    process.exit(1)
  })
}
