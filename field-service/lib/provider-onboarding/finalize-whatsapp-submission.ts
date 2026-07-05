/**
 * finalize-whatsapp-submission.ts
 *
 * Single shared "finalize" core for the WhatsApp provider-registration submit.
 *
 * Both the gate-OFF WhatsApp flow (lib/whatsapp-flows/registration.ts,
 * handlePending) and the KYC create-on-PASS completion flow
 * (lib/provider-onboarding/quality-gate-submission.ts) need to perform the exact
 * same sequence of in-transaction side-effects to finalize a WhatsApp provider
 * application:
 *
 *   1. syncProviderRecord({ skipEnrichment: true })   → resolve/create Provider
 *   2. submitProviderApplication(tx, …)               → the ONLY row creator
 *   3. providerCategory.createMany                     → per-skill category rows
 *   4. providerRate.createMany (when callOutFee set)   → per-category rate rows
 *
 * Extracting it here guarantees the two flows can never diverge again. Behavior
 * is byte-identical to the original inline block in handlePending; the completion
 * flow passes completion-safe opts (statusOverride / onConflict / initialNotes)
 * through to submitProviderApplication.
 *
 * Leaf module: imports provider-record + provider-applications-submit +
 * provider-categories/service-categories/service-category-policy only. It does
 * NOT import registration.ts or quality-gate-submission.ts, so no import cycle.
 *
 * NOTE ON SCOPE: This function owns ONLY the shared finalize core (steps 1-4).
 * Call-site-specific work — the WhatsApp flow's customer-phone guard, existing-
 * application early returns, session-attachment validation, bio, profile photo,
 * verification-attachment linking, and auditLog; the completion flow's draft +
 * verification linking, replay-attachment linking, and confirmation messages —
 * stays at each call site. Post-commit enrichment (syncProviderSkills /
 * upsertStructuredServiceAreas) also stays at the call sites: it must run AFTER
 * the transaction commits, and this function runs inside the caller's tx.
 */

import type { Prisma } from '@prisma/client'
import type { db } from '@/lib/db'
import { syncProviderRecord } from '@/lib/provider-record'
import {
  submitProviderApplication,
  type SubmitInput,
  type SubmitOptions,
} from '@/lib/provider-applications-submit'
import { resolveInitialApprovalStatus } from '@/lib/provider-categories'
import { resolveServiceCategoryTag } from '@/lib/service-categories'
import { getServiceComplianceRequirement } from '@/lib/service-category-policy'

// ─── Experience-label helpers (shared by both call sites) ─────────────────────

export function yearsExperienceFromLabel(label: string | undefined | null): number | null {
  if (!label) return null
  if (label.includes('Less')) return 0
  if (label.includes('1–3')) return 2
  if (label.includes('3–5')) return 4
  if (label.includes('5+')) return 5
  return null
}

export function skillLevelFromExperienceLabel(label: string | undefined | null): string | null {
  if (!label) return null
  if (label.includes('Less')) return 'BEGINNER'
  if (label.includes('1–3')) return 'INTERMEDIATE'
  return 'EXPERIENCED'
}

/** Canonical category slug for a skill (matches both original call sites). */
export function categorySlugForSkill(skill: string): string {
  return resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_')
}

// ─── Shared row builders (identical to the original inline logic) ─────────────

async function buildProviderCategoryRows(
  providerId: string,
  canonicalSkills: string[],
  experienceLabel: string | null | undefined,
  certificationProofCount: number,
) {
  return Promise.all(
    canonicalSkills.map(async (skill) => {
      const categorySlug = categorySlugForSkill(skill)
      const approvalStatus = await resolveInitialApprovalStatus(providerId, categorySlug)
      const compliance = getServiceComplianceRequirement(skill)
      return {
        certificationRequired: Boolean(compliance.certificationRequiredForApproval),
        certificationStatus: compliance.certificationRecommended
          ? certificationProofCount > 0
            ? 'SUBMITTED'
            : 'REQUESTED'
          : 'NOT_REQUIRED',
        providerId,
        categorySlug,
        yearsExperience: yearsExperienceFromLabel(experienceLabel),
        skillLevel: skillLevelFromExperienceLabel(experienceLabel),
        approvalStatus,
      }
    }),
  )
}

function buildProviderRateRows(
  providerId: string,
  canonicalSkills: string[],
  rate: { callOutFee: number; hourlyRate: number | null; rateNegotiable: boolean },
) {
  return canonicalSkills.map((skill) => ({
    providerId,
    categorySlug: categorySlugForSkill(skill),
    callOutFee: rate.callOutFee,
    hourlyRate: rate.hourlyRate,
    rateNegotiable: rate.rateNegotiable,
    quoteAfterInspection: false,
  }))
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Arguments forwarded verbatim to syncProviderRecord (skipEnrichment forced). */
export interface FinalizeSyncProviderArgs {
  phone: string
  name: string
  email: string | null
  skills: string[]
  serviceAreas: string[]
  active: boolean
  availableNow: boolean
  verified: boolean
  isTestUser: boolean
  cohortName: string | null
  locationNodeIds: string[]
}

export interface FinalizeWhatsappInput {
  /** Passed to syncProviderRecord (skipEnrichment is always forced to true). */
  syncProviderArgs: FinalizeSyncProviderArgs
  /** Passed to submitProviderApplication. providerId is injected from the sync result. */
  submitInput: SubmitInput
  /** Canonical skills → one providerCategory row each. */
  canonicalSkills: string[]
  /** Experience label used to derive years/skillLevel on the category rows. */
  experienceLabel: string | null | undefined
  /** Count of certification-proof attachments (drives certificationStatus). */
  certificationProofCount: number
  /**
   * When present, providerRate rows are written for every category (mirrors the
   * gate-OFF trigger: "callOutFee is a number"). When null/undefined, no rate
   * rows are written.
   */
  rate?: {
    callOutFee: number
    hourlyRate: number | null
    rateNegotiable: boolean
  } | null
}

export type FinalizeWhatsappOpts = Pick<SubmitOptions, 'statusOverride' | 'onConflict' | 'initialNotes'>

export interface FinalizeWhatsappResult {
  providerId: string
  application: Awaited<ReturnType<typeof submitProviderApplication>>['application']
  /** True when onConflict:'link' linked to a pre-existing active application. */
  conflicted: boolean
}

// ─── Public: the single WhatsApp finalizer ────────────────────────────────────

/**
 * Runs the shared WhatsApp finalize core inside the caller's transaction:
 * syncProviderRecord → submitProviderApplication → providerCategory.createMany →
 * providerRate.createMany. Returns the resolved providerId and the created (or,
 * with onConflict:'link', the linked existing) application.
 *
 * @param tx  An open Prisma transaction client (the caller owns the $transaction).
 */
export async function finalizeWhatsappProviderSubmission(
  tx: Prisma.TransactionClient,
  input: FinalizeWhatsappInput,
  opts: FinalizeWhatsappOpts = {},
): Promise<FinalizeWhatsappResult> {
  // 1. Sync provider record (creates or updates the Provider row). Enrichment is
  //    forced off inside the tx — see the note in this module's header and the
  //    warning at the registration.ts call site (a swallowed DB error in
  //    enrichment aborts the PG connection for the rest of the tx).
  const providerId = await syncProviderRecord(tx as unknown as typeof db, {
    ...input.syncProviderArgs,
    skipEnrichment: true,
  })

  // 2. Create the application — the ONLY place a ProviderApplication row is
  //    created in these flows. providerId is injected from the sync result.
  const { application, conflicted } = await submitProviderApplication(
    tx,
    { ...input.submitInput, providerId },
    {
      source: 'whatsapp',
      statusOverride: opts.statusOverride,
      onConflict: opts.onConflict,
      initialNotes: opts.initialNotes,
    },
  )

  // On a linked conflict no new row was created; the category/rate rows already
  // exist for the pre-existing application, so skip them (mirrors the completion
  // flow's conflict short-circuit, which returned before creating category/rate).
  if (conflicted) {
    return { providerId, application, conflicted: true }
  }

  // 3. Provider category rows (one per canonical skill).
  const providerCategoryRows = await buildProviderCategoryRows(
    providerId,
    input.canonicalSkills,
    input.experienceLabel,
    input.certificationProofCount,
  )
  if (providerCategoryRows.length > 0) {
    // providerCategory may not exist in all env migrations; guard with optional chaining.
    // TODO: drop the `as any` + optional chaining once providerCategory is guaranteed present in the Prisma tx client type (post-migration)
    await (tx as any).providerCategory?.createMany?.({
      data: providerCategoryRows,
      skipDuplicates: true,
    })
  }

  // 4. Provider rate rows — only when a call-out fee is present (the gate-OFF trigger).
  if (input.rate && input.canonicalSkills.length > 0) {
    const rateRows = buildProviderRateRows(providerId, input.canonicalSkills, input.rate)
    // providerRate may not exist in all env migrations; guard with optional chaining.
    // TODO: drop the `as any` + optional chaining once providerRate is guaranteed present in the Prisma tx client type (post-migration)
    await (tx as any).providerRate?.createMany?.({
      data: rateRows,
      skipDuplicates: true,
    })
  }

  return { providerId, application, conflicted: false }
}
