#!/usr/bin/env tsx
// Application triage sweep — classify + act on the provider-application queue.
// Spec: docs/superpowers/specs/2026-07-01-application-triage-sweep-design.md
//
// Default is --dry-run: prints the classification table, writes and sends NOTHING.
// Usage:
//   pnpm tsx scripts/application-triage-sweep.ts                 # dry-run, all rules
//   pnpm tsx scripts/application-triage-sweep.ts --execute       # apply all rules
//   pnpm tsx scripts/application-triage-sweep.ts --execute --rule=3

import { areaInPilot } from '@/lib/ops-agents/pilot-area'
import { getServiceComplianceRequirement } from '@/lib/service-category-policy'

export type TriageRule =
  | 'DUPLICATE'
  | 'RULE_1_NO_ID'
  | 'RULE_2_PARTIAL_APPROVE'
  | 'RULE_2B_HIGH_RISK_ONLY'
  | 'RULE_3_OUT_OF_PILOT'
  | 'SKIP_ALREADY_SWEPT'

export interface TriageInput {
  id: string
  name: string | null
  phone: string
  skills: string[]
  serviceAreas: string[]
  idNumber: string | null
  status: 'PENDING' | 'MORE_INFO_REQUIRED'
  notes: string | null
  hasVerificationRow: boolean
  isActiveProviderPhone: boolean
}

export interface TriageDecision {
  rule: TriageRule
  targetStatus: 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | null
  template:
    | 'provider_registration_continue'
    | 'provider_high_risk_cert_nudge'
    | 'provider_area_waitlist'
    | null
  approvedSkills: string[] | null
  heldSkills: string[] | null
  waitlist: boolean
  areaLabel: string | null
}

const SWEEP_MARKER = '[triage-sweep'

function normaliseSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

function isHighRisk(skillSlug: string): boolean {
  const req = getServiceComplianceRequirement(skillSlug)
  return req.riskLevel !== 'standard'
}

function hasIdCaptured(input: TriageInput): boolean {
  return Boolean(input.idNumber && input.idNumber.trim() !== '') || input.hasVerificationRow
}

function inPilot(input: TriageInput): boolean {
  return input.serviceAreas.some((area) => areaInPilot(area))
}

const NO_DECISION: Omit<TriageDecision, 'rule'> = {
  targetStatus: null,
  template: null,
  approvedSkills: null,
  heldSkills: null,
  waitlist: false,
  areaLabel: null,
}

export function classifyApplication(input: TriageInput): TriageDecision {
  if (input.notes?.includes(SWEEP_MARKER)) {
    return { rule: 'SKIP_ALREADY_SWEPT', ...NO_DECISION }
  }
  if (input.isActiveProviderPhone) {
    return { rule: 'DUPLICATE', ...NO_DECISION }
  }

  const idCaptured = hasIdCaptured(input)

  if (!inPilot(input)) {
    return {
      rule: 'RULE_3_OUT_OF_PILOT',
      targetStatus: idCaptured ? null : 'MORE_INFO_REQUIRED',
      template: 'provider_area_waitlist',
      approvedSkills: null,
      heldSkills: null,
      waitlist: true,
      areaLabel: input.serviceAreas[0]?.trim() || 'your area',
    }
  }

  if (!idCaptured) {
    return {
      rule: 'RULE_1_NO_ID',
      targetStatus: 'MORE_INFO_REQUIRED',
      template: 'provider_registration_continue',
      approvedSkills: null,
      heldSkills: null,
      waitlist: false,
      areaLabel: null,
    }
  }

  const slugs = input.skills.map(normaliseSkill)
  const held = slugs.filter(isHighRisk)
  const approved = slugs.filter((s) => !isHighRisk(s))

  if (approved.length === 0) {
    return {
      rule: 'RULE_2B_HIGH_RISK_ONLY',
      targetStatus: 'MORE_INFO_REQUIRED',
      template: 'provider_high_risk_cert_nudge',
      approvedSkills: null,
      heldSkills: held,
      waitlist: false,
      areaLabel: null,
    }
  }

  return {
    rule: 'RULE_2_PARTIAL_APPROVE',
    targetStatus: 'APPROVED',
    template: 'provider_high_risk_cert_nudge',
    approvedSkills: approved,
    heldSkills: held,
    waitlist: false,
    areaLabel: null,
  }
}

// ─── Execution types ──────────────────────────────────────────────────────────

export interface SweepOptions {
  execute: boolean
  rules: number[]                        // subset of [1, 2, 3, 4]
  waitlistTemplateApproved?: boolean     // injected in tests; CLI resolves via Graph API
  now?: Date
}

export interface SweepRow {
  applicationId: string
  name: string
  phoneTail: string                      // last 4 digits only
  rule: TriageRule
  statusChange: string | null            // "PENDING → APPROVED" | null
  template: string | null
  sendSkippedReason: 'RECENTLY_MESSAGED' | 'TEMPLATE_NOT_APPROVED' | null
}

export interface SweepReport {
  rows: SweepRow[]
  kyc?: { targeted: number; sent: number; skipped: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function firstNameFrom(name: string | null): string {
  if (!name?.trim()) return 'there'
  return name.trim().split(/\s+/)[0]
}

function ruleNumber(rule: TriageRule): number {
  if (rule === 'RULE_1_NO_ID') return 1
  if (rule === 'RULE_2_PARTIAL_APPROVE' || rule === 'RULE_2B_HIGH_RISK_ONLY') return 2
  if (rule === 'RULE_3_OUT_OF_PILOT') return 3
  return 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

// ─── runSweep ─────────────────────────────────────────────────────────────────

export async function runSweep(opts: SweepOptions): Promise<SweepReport> {
  // All DB / send imports are dynamic so classifyApplication remains importable
  // without a DB connection (keeps the 10 classification tests fast + isolated).
  const { db } = await import('@/lib/db')
  const { sendTemplate } = await import('@/lib/whatsapp')
  const { syncProviderRecord } = await import('@/lib/provider-record')

  const now = opts.now ?? new Date()
  const dateStr = toDateString(now)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // ── Load queue ────────────────────────────────────────────────────────────
  const rawApps = await db.providerApplication.findMany({
    where: { status: { in: ['PENDING', 'MORE_INFO_REQUIRED'] } },
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      serviceAreas: true,
      idNumber: true,
      status: true,
      notes: true,
      providerId: true,
    },
  })

  // Active provider phones (for duplicate detection)
  const activeProviders = await db.provider.findMany({
    where: { active: true },
    select: { phone: true },
  })
  const activePhoneSet = new Set(activeProviders.map((p: { phone: string }) => p.phone))

  // Verification rows (for Bernard-edge ID capture): linked by providerApplicationId
  const verificationRows = await db.providerIdentityVerification.findMany({
    where: { providerApplicationId: { in: rawApps.map((a: { id: string }) => a.id) } },
    select: { providerApplicationId: true },
  })
  const verifiedAppIdSet = new Set(
    verificationRows
      .map((v: { providerApplicationId: string | null }) => v.providerApplicationId)
      .filter(Boolean),
  )

  // ── Build TriageInputs and classify ──────────────────────────────────────
  const rows: SweepRow[] = []

  for (const app of rawApps) {
    const input: TriageInput = {
      id: app.id,
      name: app.name ?? null,
      phone: app.phone,
      skills: (app.skills as string[]) ?? [],
      serviceAreas: (app.serviceAreas as string[]) ?? [],
      idNumber: app.idNumber ?? null,
      status: app.status as 'PENDING' | 'MORE_INFO_REQUIRED',
      notes: app.notes ?? null,
      hasVerificationRow: verifiedAppIdSet.has(app.id),
      isActiveProviderPhone: activePhoneSet.has(app.phone),
    }

    const decision = classifyApplication(input)
    const n = ruleNumber(decision.rule)

    // Filter by requested rules (DUPLICATE / SKIP_ALREADY_SWEPT pass through
    // for reporting but never produce writes)
    const actionable = decision.rule !== 'DUPLICATE' && decision.rule !== 'SKIP_ALREADY_SWEPT'
    const ruleRequested = opts.rules.includes(n)

    const row: SweepRow = {
      applicationId: app.id,
      name: app.name ?? '',
      phoneTail: app.phone.slice(-4),
      rule: decision.rule,
      statusChange: null,
      template: decision.template,
      sendSkippedReason: null,
    }

    if (!opts.execute || !actionable || !ruleRequested) {
      // Dry-run or not in scope: classify only
      if (decision.targetStatus && decision.targetStatus !== app.status) {
        row.statusChange = `${app.status} → ${decision.targetStatus}`
      }
      rows.push(row)
      continue
    }

    // ── Execute path ──────────────────────────────────────────────────────
    const markerSuffix = `\n[triage-sweep ${dateStr} rule-${n}]`
    const oldStatus = app.status
    const newStatus = decision.targetStatus ?? oldStatus

    if (newStatus !== oldStatus) {
      row.statusChange = `${oldStatus} → ${newStatus}`
    }

    // Rule-2 PARTIAL_APPROVE: sync provider record first
    if (decision.rule === 'RULE_2_PARTIAL_APPROVE') {
      await syncProviderRecord(db, {
        phone: app.phone,
        name: app.name ?? '',
        skills: decision.approvedSkills ?? [],
        serviceAreas: (app.serviceAreas as string[]) ?? [],
        active: true,
        availableNow: true,
        verified: true,
      })
    }

    // Status + notes update
    await db.providerApplication.update({
      where: { id: app.id },
      data: {
        ...(newStatus !== oldStatus ? { status: newStatus } : {}),
        notes: `${app.notes ?? ''}${markerSuffix}`,
        reviewedAt: now,
      },
    })

    // AuditLog entry
    await db.auditLog.create({
      data: {
        actorId: 'triage-sweep',
        actorRole: 'SYSTEM',
        action: 'application.triage_sweep',
        entityType: 'ProviderApplication',
        entityId: app.id,
        before: JSON.stringify({ status: oldStatus }),
        after: JSON.stringify({ status: newStatus, rule: decision.rule }),
      },
    })

    // Rule-3: upsert serviceAreaWaitlist
    if (decision.rule === 'RULE_3_OUT_OF_PILOT' && decision.waitlist) {
      const city = decision.areaLabel ?? 'unknown'
      await db.serviceAreaWaitlist.upsert({
        where: { phone_city: { phone: app.phone, city } },
        create: {
          phone: app.phone,
          name: app.name ?? null,
          city,
          source: 'triage-sweep',
        },
        update: {},
      })
    }

    // Template send (with dedup)
    if (decision.template) {
      // Template-approved check runs first (no point querying dedup if template
      // is not approved — and avoids a stale mock bleed in tests)
      if (
        decision.rule === 'RULE_3_OUT_OF_PILOT' &&
        opts.waitlistTemplateApproved === false
      ) {
        row.sendSkippedReason = 'TEMPLATE_NOT_APPROVED'
      } else {
        // Dedup check: same template to same phone within 7 days
        const recentSend = await db.messageEvent.findFirst({
          where: {
            to: app.phone,
            templateName: decision.template,
            sentAt: { gte: sevenDaysAgo },
          },
        })

        if (recentSend) {
          row.sendSkippedReason = 'RECENTLY_MESSAGED'
        } else {
          const firstName = firstNameFrom(app.name)

          type BodyComponent = {
            type: 'body'
            parameters: Array<{ type: 'text'; text: string }>
          }
          let components: BodyComponent[]

          if (decision.template === 'provider_area_waitlist') {
            const areaLabel = decision.areaLabel ?? 'your area'
            components = [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: firstName },
                  { type: 'text', text: areaLabel },
                ],
              },
            ]
          } else {
            // provider_high_risk_cert_nudge: 1 body param (firstName)
            // provider_registration_continue: 1 body param (firstName); quick-reply
            // button payload "reg_start" is handled by the WhatsApp flow router on
            // receipt — no button component needed in the outbound template send
            components = [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }]
          }

          await sendTemplate({
            to: app.phone,
            template: decision.template,
            components,
          })

          await sleep(300)
        }
      }
    }

    rows.push(row)
  }

  // ── Rule 4: KYC drive (delegate to existing helper) ───────────────────
  let kyc: SweepReport['kyc']
  if (opts.rules.includes(4) && opts.execute) {
    try {
      const { sendKycDriveNudges } = await import('@/lib/kyc-drive/nudge')
      const { issueProviderIdentityVerificationLink } = await import(
        '@/lib/identity-verification/link'
      )

      const result = await sendKycDriveNudges(db as Parameters<typeof sendKycDriveNudges>[0], {
        deadline: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        batchCap: 50,
        deps: {
          issueLink: ({ providerId }) =>
            issueProviderIdentityVerificationLink({ providerId }),
          recordAttempt: async ({ to, metadata }) => {
            await db.messageEvent.create({
              data: {
                channel: 'WHATSAPP',
                direction: 'OUTBOUND',
                to,
                templateName: 'provider_kyc_nudge',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                metadata: metadata as any,
                sentAt: now,
              },
            })
          },
          send: ({ providerPhone, providerFirstName, deadline, verificationUrl, metadata }) =>
            sendTemplate({
              to: providerPhone,
              template: 'provider_kyc_nudge',
              components: [
                {
                  type: 'body' as const,
                  parameters: [
                    { type: 'text' as const, text: providerFirstName },
                    { type: 'text' as const, text: deadline },
                    { type: 'text' as const, text: verificationUrl },
                  ],
                },
              ],
              metadata,
            }),
        },
      })
      kyc = {
        targeted: result.rows.length,
        sent: result.sent,
        skipped: result.skipped,
      }
    } catch (err) {
      console.error('[triage-sweep] rule-4 KYC drive error:', err)
      kyc = { targeted: 0, sent: 0, skipped: 0 }
    }
  }

  return { rows, kyc }
}

// ─── Graph API template-status check ──────────────────────────────────────────

async function checkWaitlistTemplateApproved(): Promise<boolean> {
  const wabaId = process.env.WHATSAPP_WABA_ID
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!wabaId || !token) {
    console.warn('[triage-sweep] WHATSAPP_WABA_ID or WHATSAPP_ACCESS_TOKEN not set — treating provider_area_waitlist as NOT approved')
    return false
  }
  try {
    const url = `https://graph.facebook.com/v19.0/${wabaId}/message_templates?name=provider_area_waitlist&fields=name,status,category,language`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json() as { data?: Array<{ status: string }> }
    const templates = json.data ?? []
    return templates.some((t) => t.status === 'APPROVED')
  } catch (err) {
    console.warn('[triage-sweep] Graph API check failed — treating provider_area_waitlist as NOT approved:', err)
    return false
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const { db } = await import('@/lib/db')
  try {
    const args = process.argv.slice(2)
    const execute = args.includes('--execute')
    const ruleArgs = args.filter((a) => a.startsWith('--rule=')).map((a) => parseInt(a.replace('--rule=', ''), 10))
    const rules = ruleArgs.length > 0 ? ruleArgs : [1, 2, 3, 4]

    console.log(`[triage-sweep] mode=${execute ? 'EXECUTE' : 'DRY-RUN'} rules=${rules.join(',')}`)

    const waitlistTemplateApproved = await checkWaitlistTemplateApproved()
    if (!waitlistTemplateApproved) {
      console.warn('[triage-sweep] provider_area_waitlist not approved — rule-3 sends will be deferred')
    }

    const report = await runSweep({ execute, rules, waitlistTemplateApproved })

    // Print aligned table (phone tails only)
    const COL = { id: 10, name: 20, tail: 6, rule: 28, change: 22, template: 32, skip: 22 }
    const header = [
      'AppID'.padEnd(COL.id),
      'Name'.padEnd(COL.name),
      'Ph'.padEnd(COL.tail),
      'Rule'.padEnd(COL.rule),
      'StatusChange'.padEnd(COL.change),
      'Template'.padEnd(COL.template),
      'SkipReason'.padEnd(COL.skip),
    ].join('  ')
    console.log('\n' + header)
    console.log('-'.repeat(header.length))
    for (const row of report.rows) {
      console.log([
        row.applicationId.slice(-8).padEnd(COL.id),
        (row.name ?? '').slice(0, COL.name - 1).padEnd(COL.name),
        ('…' + row.phoneTail).padEnd(COL.tail),
        row.rule.padEnd(COL.rule),
        (row.statusChange ?? '-').padEnd(COL.change),
        (row.template ?? '-').padEnd(COL.template),
        (row.sendSkippedReason ?? '-').padEnd(COL.skip),
      ].join('  '))
    }
    console.log(`\nTotal: ${report.rows.length} rows`)
    if (report.kyc) {
      console.log(`KYC drive: targeted=${report.kyc.targeted} sent=${report.kyc.sent} skipped=${report.kyc.skipped}`)
    }
    if (!execute) {
      console.log('\n[dry-run] Pass --execute to apply changes.')
    }
  } finally {
    await db.$disconnect()
  }
}

// Run CLI when invoked directly (tsx scripts/application-triage-sweep.ts)
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('[triage-sweep] fatal:', err)
    process.exit(1)
  })
}
