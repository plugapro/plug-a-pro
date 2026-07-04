import { randomBytes } from 'crypto'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import {
  findLatestActiveProviderApplicationByPhone,
  normalizeProviderApplicationPhone,
} from '@/lib/provider-applications'
import { syncProviderRecord, upsertStructuredServiceAreas } from '@/lib/provider-record'
import {
  normalizeServiceCategorySelections,
  resolveServiceCategoryTag,
} from '@/lib/service-categories'
import { createTestCohortContext } from '@/lib/internal-test-cohort'
import { evaluateProviderProfileCompleteness } from '@/lib/provider-onboarding-completeness'
import { isQualityGateV2Enabled, evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from '@/lib/location-format'
import { issueProviderApplicationVerificationLink } from '@/lib/identity-verification/application-link'
import { hashRegistrationResumeToken } from './tokens'

const RESUME_TOKEN_PURPOSE = 'provider_registration_resume'
const RESUME_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class ProviderRegistrationValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 422,
  ) {
    super(message)
  }
}

export type ProviderRegistrationDraftInput = {
  draftId?: string | null
  resumeToken?: string | null
  phone: string
  email?: string | null
  name?: string | null
  businessName?: string | null
  preferredContact?: string | null
  identityBasis?: string | null
  profilePhotoUrl?: string | null
  skills?: string[] | string | null
  categorySlugs?: string[] | string | null
  serviceAreas?: string[] | string | null
  locationNodeIds?: string[] | null
  provinceId?: string | null
  cityId?: string | null
  regionId?: string | null
  experience?: string | null
  bio?: string | null
  availability?: string | null
  availabilityDays?: string[] | null
  availabilityHours?: string | null
  emergencyAvailable?: boolean | null
  callOutFee?: number | string | null
  travelRadiusKm?: number | string | null
  evidenceNote?: string | null
  reference1Name?: string | null
  reference1Mobile?: string | null
  reference2Name?: string | null
  reference2Mobile?: string | null
  consentAccepted?: boolean | null
  lastCompletedStep?: number | null
}

export type ProviderRegistrationSubmitInput = ProviderRegistrationDraftInput & {
  draftId: string
  resumeToken: string
  name: string
  consentAccepted: boolean
  evidenceFileUrls?: string[] | null
  certificationRef?: string | null
}

type DraftClient = {
  locationNode?: {
    findMany: (...args: any[]) => Promise<ProviderRegistrationLocationNode[]>
  }
  providerApplicationDraft: {
    create: (...args: any[]) => Promise<{ id: string }>
    update: (...args: any[]) => Promise<{ id: string }>
  }
  registrationResumeToken: {
    create: (...args: any[]) => Promise<unknown>
    findUnique: (...args: any[]) => Promise<{
      draftId: string
      expiresAt: Date
      consumedAt: Date | null
    } | null>
  }
}

type SubmitTransactionClient = {
  locationNode?: {
    findMany: (...args: any[]) => Promise<ProviderRegistrationLocationNode[]>
  }
  technicianServiceArea?: {
    upsert: (...args: any[]) => Promise<unknown>
  }
  customer: { findFirst: (...args: any[]) => Promise<{ id: string } | null> }
  providerApplication: {
    findFirst: (...args: any[]) => Promise<{
      id: string
      phone: string
      status: string
      name?: string | null
      providerId?: string | null
      submittedAt?: Date
    } | null>
    create: (...args: any[]) => Promise<{ id: string }>
  }
  providerApplicationDraft: { update: (...args: any[]) => Promise<unknown> }
  registrationResumeToken: {
    findUnique: (...args: any[]) => Promise<{
      draftId: string
      purpose: string
      expiresAt: Date
      consumedAt: Date | null
      draft?: { id: string; phone: string } | null
    } | null>
    updateMany: (...args: any[]) => Promise<unknown>
  }
  providerCategory?: { createMany: (...args: any[]) => Promise<unknown> }
  providerRate?: { createMany: (...args: any[]) => Promise<unknown> }
}

type SubmitClient = {
  $transaction: <T>(callback: (tx: SubmitTransactionClient & any) => Promise<T>) => Promise<T>
}

type ProviderRegistrationLocationNode = {
  id: string
  nodeType: string
  slug: string
  label: string
  postalCode?: string | null
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
  parent?: {
    id: string
    nodeType: string
    label?: string | null
    parent?: {
      id: string
      nodeType: string
      label?: string | null
      parent?: {
        id: string
        nodeType: string
        label?: string | null
      } | null
    } | null
  } | null
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function cleanUrlString(value: unknown): string | null {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    if (parsed.protocol === 'https:' && (host === 'vercel-storage.com' || host.endsWith('.vercel-storage.com'))) {
      return trimmed
    }
    return null
  } catch {
    return null
  }
}

function stringList(value: string[] | string | null | undefined): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : []

  return Array.from(new Set(
    raw.map((entry) => entry.trim()).filter(Boolean),
  ))
}

function normalizedPhone(rawPhone: string): string {
  const normalized = normalizeOtpPhoneNumber(rawPhone, 'ZA')
  if (!normalized.ok) {
    throw new ProviderRegistrationValidationError(normalized.reason, normalized.errorCode)
  }
  return normalized.e164
}

function normalizedCallOutFee(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20_000) {
    throw new ProviderRegistrationValidationError('Enter a valid call-out fee.', 'INVALID_CALL_OUT_FEE')
  }
  return parsed
}

function normalizedTravelRadius(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ProviderRegistrationValidationError('Choose a valid travel radius.', 'INVALID_TRAVEL_RADIUS')
  }
  return parsed
}

function safeStep(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 0
  return Math.max(0, Math.min(8, Number(value)))
}

function normalizeDraftInputBase(input: ProviderRegistrationDraftInput) {
  const phone = normalizedPhone(input.phone)
  const skills = normalizeServiceCategorySelections(stringList(input.skills))
  const selectedCategorySlugs = normalizeServiceCategorySelections(stringList(input.categorySlugs))
  const categorySlugs = selectedCategorySlugs.length > 0 ? selectedCategorySlugs : skills
  const serviceAreas = normaliseLocationDisplayNames(stringList(input.serviceAreas))
  const locationNodeIds = stringList(input.locationNodeIds ?? [])
  const availabilityDays = stringList(input.availabilityDays ?? [])
  const availability = cleanString(input.availability) ?? availabilityDays.join(', ')
  const callOutFee = normalizedCallOutFee(input.callOutFee)

  return {
    phone,
    email: cleanString(input.email),
    name: cleanString(input.name),
    businessName: cleanString(input.businessName),
    preferredContact: cleanString(input.preferredContact),
    identityBasis: cleanString(input.identityBasis),
    profilePhotoUrl: cleanUrlString(input.profilePhotoUrl),
    skills,
    categorySlugs,
    serviceAreas,
    locationNodeIds,
    experience: cleanString(input.experience),
    bio: cleanString(input.bio),
    availability,
    availabilityDays,
    availabilityHours: cleanString(input.availabilityHours),
    emergencyAvailable: input.emergencyAvailable === true,
    callOutFee,
    travelRadiusKm: normalizedTravelRadius(input.travelRadiusKm),
    evidenceNote: cleanString(input.evidenceNote),
    reference1Name: cleanString(input.reference1Name),
    reference1Mobile: cleanString(input.reference1Mobile),
    reference2Name: cleanString(input.reference2Name),
    reference2Mobile: cleanString(input.reference2Mobile),
    consentAt: input.consentAccepted ? new Date() : null,
    lastCompletedStep: safeStep(input.lastCompletedStep),
  }
}

function requireStructuredServiceAreas(lastCompletedStep: number | null | undefined): boolean {
  return safeStep(lastCompletedStep) >= 4
}

function locationHierarchyError(): ProviderRegistrationValidationError {
  return new ProviderRegistrationValidationError(
    'Choose a valid province, city, region and suburb combination.',
    'INVALID_LOCATION_HIERARCHY',
  )
}

async function resolveCanonicalServiceAreas(
  client: Pick<DraftClient, 'locationNode'>,
  input: ProviderRegistrationDraftInput,
  locationNodeIds: string[],
  fallbackServiceAreas: string[],
  requireStructured: boolean,
): Promise<{ locationNodeIds: string[]; serviceAreas: string[] }> {
  if (locationNodeIds.length === 0) {
    if (requireStructured) {
      throw new ProviderRegistrationValidationError(
        'Select at least one suburb from the list.',
        'STRUCTURED_SERVICE_AREA_REQUIRED',
      )
    }
    return { locationNodeIds: [], serviceAreas: fallbackServiceAreas }
  }

  if (requireStructured && (!input.provinceId || !input.cityId || !input.regionId)) {
    throw locationHierarchyError()
  }

  if (!client.locationNode?.findMany) {
    throw new ProviderRegistrationValidationError(
      'Location options are not available right now.',
      'LOCATION_DATA_UNAVAILABLE',
      500,
    )
  }

  const nodes = await client.locationNode.findMany({
    where: {
      id: { in: locationNodeIds },
      nodeType: 'SUBURB',
      active: true,
      postalCode: { not: null },
    },
    select: {
      id: true,
      nodeType: true,
      slug: true,
      label: true,
      postalCode: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      parent: {
        select: {
          id: true,
          nodeType: true,
          label: true,
          parent: {
            select: {
              id: true,
              nodeType: true,
              label: true,
              parent: {
                select: {
                  id: true,
                  nodeType: true,
                  label: true,
                },
              },
            },
          },
        },
      },
    },
  })

  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  if (nodesById.size !== locationNodeIds.length) {
    throw new ProviderRegistrationValidationError(
      'Select a valid suburb from the list.',
      'INVALID_LOCATION_NODE',
    )
  }

  const serviceAreas: string[] = []
  for (const locationNodeId of locationNodeIds) {
    const node = nodesById.get(locationNodeId)
    const region = node?.parent
    const city = region?.parent
    const province = city?.parent

    if (
      !node ||
      node.nodeType !== 'SUBURB' ||
      !node.postalCode ||
      !region ||
      region.nodeType !== 'REGION' ||
      !city ||
      city.nodeType !== 'CITY' ||
      !province ||
      province.nodeType !== 'PROVINCE'
    ) {
      throw locationHierarchyError()
    }

    if (input.regionId && region.id !== input.regionId) throw locationHierarchyError()
    if (input.cityId && city.id !== input.cityId) throw locationHierarchyError()
    if (input.provinceId && province.id !== input.provinceId) throw locationHierarchyError()

    serviceAreas.push(normaliseLocationDisplayName(node.label))
  }

  return { locationNodeIds, serviceAreas }
}

async function normalizeDraftInput(
  client: Pick<DraftClient, 'locationNode'>,
  input: ProviderRegistrationDraftInput,
  options?: { requireStructuredServiceAreas?: boolean },
) {
  const data = normalizeDraftInputBase(input)
  const requireStructured = options?.requireStructuredServiceAreas ?? requireStructuredServiceAreas(input.lastCompletedStep)
  const location = await resolveCanonicalServiceAreas(
    client,
    input,
    data.locationNodeIds,
    data.serviceAreas,
    requireStructured,
  )

  return {
    ...data,
    serviceAreas: location.serviceAreas,
    locationNodeIds: location.locationNodeIds,
  }
}

function newResumeToken(): string {
  return randomBytes(32).toString('base64url')
}

async function resolveTokenDraftId(client: DraftClient, resumeToken?: string | null): Promise<string | null> {
  if (!resumeToken) return null

  const tokenHash = await hashRegistrationResumeToken(resumeToken)
  const token = await client.registrationResumeToken.findUnique({
    where: { tokenHash },
    select: { draftId: true, expiresAt: true, consumedAt: true },
  })

  if (!token || token.consumedAt || token.expiresAt.getTime() <= Date.now()) return null
  return token.draftId
}

export async function saveProviderRegistrationDraft(
  client: DraftClient,
  input: ProviderRegistrationDraftInput,
): Promise<{ draftId: string; resumeToken: string }> {
  const data = await normalizeDraftInput(client, input)
  const tokenDraftId = await resolveTokenDraftId(client, input.resumeToken)

  if (tokenDraftId) {
    await client.providerApplicationDraft.update({
      where: { id: tokenDraftId },
      data,
    })
    return { draftId: tokenDraftId, resumeToken: input.resumeToken ?? '' }
  }

  const draft = await client.providerApplicationDraft.create({ data })
  const resumeToken = newResumeToken()
  const tokenHash = await hashRegistrationResumeToken(resumeToken)

  await client.registrationResumeToken.create({
    data: {
      draftId: draft.id,
      tokenHash,
      purpose: RESUME_TOKEN_PURPOSE,
      expiresAt: new Date(Date.now() + RESUME_TOKEN_TTL_MS),
    },
  })

  return { draftId: draft.id, resumeToken }
}

function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '')
  return Array.from(new Set([
    phone,
    digits ? `+${digits}` : null,
    digits || null,
    digits.startsWith('27') ? `0${digits.slice(2)}` : null,
  ].filter(Boolean) as string[]))
}

function yearsExperienceFromLabel(label: string | null): number | null {
  if (!label) return null
  if (label.includes('0-1')) return 1
  if (label.includes('1-3')) return 2
  if (label.includes('3-5')) return 4
  if (label.includes('5+')) return 6
  return null
}

function skillLevelFromExperienceLabel(label: string | null): string | null {
  const years = yearsExperienceFromLabel(label)
  if (years === null) return null
  if (years >= 5) return 'EXPERIENCED'
  if (years >= 3) return 'INTERMEDIATE'
  return 'ENTRY'
}

function applicationRef(id: string): string {
  return id.slice(-8).toUpperCase()
}

function hasWeekendAvailability(days: string[]): boolean {
  return days.some((day) => {
    const normalized = day.trim().toLowerCase()
    return normalized === 'sat'
      || normalized === 'sun'
      || normalized === 'saturday'
      || normalized === 'sunday'
      || normalized.includes('weekend')
  })
}

export async function submitProviderRegistrationApplication(
  client: SubmitClient,
  input: ProviderRegistrationSubmitInput,
): Promise<
  | { outcome: 'created'; applicationId: string; ref: string }
  | { outcome: 'existing_pending' | 'existing_approved' | 'existing_more_info'; applicationId: string; ref: string }
  | { outcome: 'awaiting_verification'; verificationUrl: string | null }
> {
  const baseData = normalizeDraftInputBase({ ...input, lastCompletedStep: 8 })
  const name = cleanString(input.name)

  if (!name) {
    throw new ProviderRegistrationValidationError('Enter your full name.', 'MISSING_NAME')
  }
  if (!input.consentAccepted) {
    throw new ProviderRegistrationValidationError('Accept the provider terms before submitting.', 'CONSENT_REQUIRED')
  }

  if (!input.resumeToken || !input.draftId) {
    throw new ProviderRegistrationValidationError(
      'Could not verify this registration. Please restart and try again.',
      'INVALID_RESUME_TOKEN',
      400,
    )
  }

  const tokenHash = await hashRegistrationResumeToken(input.resumeToken)

  // Check quality gate BEFORE entering the transaction so we can branch cleanly.
  const gateEnabled = await isQualityGateV2Enabled()

  if (gateEnabled) {
    // Gate ON: validate token (without consuming it), run all pre-create guards
    // (P1: customer-phone, existing-app, completeness, service-area canonicalization),
    // persist submitPayload onto the draft, issue a verification link, and return
    // awaiting_verification. Guards must mirror the gate-OFF transaction exactly so
    // both paths reject customer-owned phones and duplicate applicants identically.
    type GateOnTxResult =
      | { kind: 'ok'; draftId: string }
      | { kind: 'existing'; outcome: 'existing_approved' | 'existing_more_info' | 'existing_pending'; applicationId: string }

    const txResult = await client.$transaction(async (tx): Promise<GateOnTxResult> => {
      const genericTokenError = new ProviderRegistrationValidationError(
        'Could not verify this registration. Please restart and try again.',
        'INVALID_RESUME_TOKEN',
        400,
      )

      const resumeToken = await tx.registrationResumeToken.findUnique({
        where: { tokenHash },
        select: {
          draftId: true,
          purpose: true,
          expiresAt: true,
          consumedAt: true,
          draft: { select: { id: true, phone: true } },
        },
      })

      if (
        !resumeToken ||
        resumeToken.purpose !== RESUME_TOKEN_PURPOSE ||
        resumeToken.consumedAt ||
        resumeToken.expiresAt.getTime() <= Date.now() ||
        resumeToken.draftId !== input.draftId
      ) {
        throw genericTokenError
      }

      const tokenDraftPhone = resumeToken.draft?.phone
      if (
        !tokenDraftPhone ||
        normalizeProviderApplicationPhone(tokenDraftPhone) !== normalizeProviderApplicationPhone(baseData.phone)
      ) {
        throw genericTokenError
      }

      // P1 guard: run the same validation the gate-OFF path runs before it
      // creates rows — service-area canonicalization, completeness, customer-phone
      // rejection, and existing-application short-circuit. Token validation above
      // gates all of these so enumeration risk is unchanged.
      const location = await resolveCanonicalServiceAreas(
        tx,
        input,
        baseData.locationNodeIds,
        baseData.serviceAreas,
        true,
      )
      const canonicalData = {
        ...baseData,
        serviceAreas: location.serviceAreas,
        locationNodeIds: location.locationNodeIds,
      }

      const completeness = evaluateProviderProfileCompleteness({
        phone: canonicalData.phone,
        name,
        skills: canonicalData.skills,
        serviceAreas: canonicalData.serviceAreas,
        locationNodeIds: canonicalData.locationNodeIds,
        availability: canonicalData.availability,
        callOutFee: canonicalData.callOutFee,
      })
      if (!completeness.canSubmit) {
        throw new ProviderRegistrationValidationError(
          'Complete the required registration fields before submitting.',
          'INCOMPLETE_APPLICATION',
        )
      }

      const existingCustomer = await tx.customer.findFirst({
        where: { phone: { in: phoneVariants(canonicalData.phone) } },
        select: { id: true },
      })
      if (existingCustomer) {
        throw new ProviderRegistrationValidationError(
          'This number is already registered as a customer on Plug A Pro.',
          'PHONE_REGISTERED_AS_CUSTOMER',
          409,
        )
      }

      // Existing active applications: return discriminated value (not throw) so
      // the tx commits cleanly and the caller can surface the right outcome.
      const existingApp = await findLatestActiveProviderApplicationByPhone(tx, canonicalData.phone)
      if (existingApp?.status === 'APPROVED') {
        return { kind: 'existing', outcome: 'existing_approved', applicationId: existingApp.id }
      }
      if (existingApp?.status === 'MORE_INFO_REQUIRED') {
        return { kind: 'existing', outcome: 'existing_more_info', applicationId: existingApp.id }
      }
      if (existingApp?.status === 'PENDING') {
        return { kind: 'existing', outcome: 'existing_pending', applicationId: existingApp.id }
      }

      // Fix B: enforce evidence/cert gates before issuing a paid KYC session.
      // A caller POST-ing with evidenceFileUrls:[] or missing certificationRef must
      // be rejected here — not after a Didit session is consumed.
      const evidenceResult = evaluateEvidenceGate(input.evidenceFileUrls ?? [])
      if (!evidenceResult.ok) {
        throw new ProviderRegistrationValidationError(
          `Upload at least ${evidenceResult.need} work photos before submitting.`,
          'QUALITY_GATE_EVIDENCE',
          422,
        )
      }
      const certResult = evaluateCertificationGate(canonicalData.skills, Boolean(input.certificationRef))
      if (!certResult.ok) {
        throw new ProviderRegistrationValidationError(
          'A certification document or registration number is required for your selected trade(s).',
          'QUALITY_GATE_CERTIFICATION',
          422,
        )
      }

      const submitPayload = {
        version: 1 as const,
        channel: 'PWA_SELF_SERVE' as const,
        submittedAt: new Date().toISOString(),
        name,
        phone: canonicalData.phone,
        email: canonicalData.email,
        skills: canonicalData.skills,
        // In the PWA flow, skills serve as category slugs
        categorySlugs: canonicalData.skills,
        // Use canonical service areas and location node IDs (resolved above)
        serviceAreas: canonicalData.serviceAreas,
        locationNodeIds: canonicalData.locationNodeIds,
        experience: canonicalData.experience,
        availability: canonicalData.availability,
        availabilityDays: canonicalData.availabilityDays,
        emergencyAvailable: canonicalData.emergencyAvailable,
        callOutFee: canonicalData.callOutFee,
        hourlyRate: null,
        travelRadiusKm: canonicalData.travelRadiusKm,
        evidenceNote: canonicalData.evidenceNote,
        evidenceFileUrls: input.evidenceFileUrls ?? [],
        certificationRef: input.certificationRef ?? null,
        reference1Name: canonicalData.reference1Name,
        reference1Mobile: canonicalData.reference1Mobile,
        reference2Name: canonicalData.reference2Name,
        reference2Mobile: canonicalData.reference2Mobile,
        bio: canonicalData.bio,
        profilePhotoUrl: canonicalData.profilePhotoUrl,
      }

      await tx.providerApplicationDraft.update({
        where: { id: input.draftId },
        // TODO: Prisma types Json fields as `InputJsonValue` but the inferred
        // object literal doesn't satisfy that structural type. Cast via
        // `unknown` until Prisma generates a stricter helper or we upgrade.
        data: { submitPayload: submitPayload as unknown as import('@prisma/client').Prisma.InputJsonValue, lastCompletedStep: 8 },
      })

      return { kind: 'ok', draftId: input.draftId }
    })

    // If an existing active application was found, surface the same outcome as
    // the gate-OFF path so callers see identical behaviour regardless of gate state.
    if (txResult.kind === 'existing') {
      return {
        outcome: txResult.outcome,
        applicationId: txResult.applicationId,
        ref: applicationRef(txResult.applicationId),
      }
    }

    const draftId = txResult.draftId

    // Issue verification link outside the transaction (idempotent, uses db internally).
    let link: { verificationUrl: string | null }
    try {
      link = await issueProviderApplicationVerificationLink({
        providerApplicationDraftId: draftId,
        channel: 'PWA',
      })
    } catch (err) {
      console.error('[pwa-flow] verification link issue failed (Didit unavailable, draft retained)', {
        draft_id: draftId,
        error: err instanceof Error ? err.message : String(err),
      })
      return { outcome: 'awaiting_verification', verificationUrl: null }
    }

    return { outcome: 'awaiting_verification', verificationUrl: link.verificationUrl }
  }

  return client.$transaction(async (tx) => {
    // SECURITY: validate the resume token FIRST, before any DB write or any
    // enumeration-risk response (PHONE_REGISTERED_AS_CUSTOMER / existing_*). The
    // token must exist, be of the registration-resume purpose, be unexpired and
    // unconsumed, and belong to the submitted draft. The draft's verified phone
    // must also match the submitted phone. All failures return a single generic
    // 400 so unauthenticated callers cannot probe which numbers are registered.
    const genericTokenError = new ProviderRegistrationValidationError(
      'Could not verify this registration. Please restart and try again.',
      'INVALID_RESUME_TOKEN',
      400,
    )

    const resumeToken = await tx.registrationResumeToken.findUnique({
      where: { tokenHash },
      select: {
        draftId: true,
        purpose: true,
        expiresAt: true,
        consumedAt: true,
        draft: { select: { id: true, phone: true } },
      },
    })

    if (
      !resumeToken ||
      resumeToken.purpose !== RESUME_TOKEN_PURPOSE ||
      resumeToken.consumedAt ||
      resumeToken.expiresAt.getTime() <= Date.now() ||
      resumeToken.draftId !== input.draftId
    ) {
      throw genericTokenError
    }

    const tokenDraftPhone = resumeToken.draft?.phone
    if (
      !tokenDraftPhone ||
      normalizeProviderApplicationPhone(tokenDraftPhone) !== normalizeProviderApplicationPhone(baseData.phone)
    ) {
      throw genericTokenError
    }

    const location = await resolveCanonicalServiceAreas(
      tx,
      input,
      baseData.locationNodeIds,
      baseData.serviceAreas,
      true,
    )
    const data = {
      ...baseData,
      serviceAreas: location.serviceAreas,
      locationNodeIds: location.locationNodeIds,
    }
    const completeness = evaluateProviderProfileCompleteness({
      phone: data.phone,
      name,
      skills: data.skills,
      serviceAreas: data.serviceAreas,
      locationNodeIds: data.locationNodeIds,
      availability: data.availability,
      callOutFee: data.callOutFee,
    })
    if (!completeness.canSubmit) {
      throw new ProviderRegistrationValidationError('Complete the required registration fields before submitting.', 'INCOMPLETE_APPLICATION')
    }

    const existingCustomer = await tx.customer.findFirst({
      where: { phone: { in: phoneVariants(data.phone) } },
      select: { id: true },
    })
    if (existingCustomer) {
      throw new ProviderRegistrationValidationError(
        'This number is already registered as a customer on Plug A Pro.',
        'PHONE_REGISTERED_AS_CUSTOMER',
        409,
      )
    }

    const existingApp = await findLatestActiveProviderApplicationByPhone(tx, data.phone)
    if (existingApp?.status === 'APPROVED') {
      return { outcome: 'existing_approved', applicationId: existingApp.id, ref: applicationRef(existingApp.id) }
    }
    if (existingApp?.status === 'MORE_INFO_REQUIRED') {
      return { outcome: 'existing_more_info', applicationId: existingApp.id, ref: applicationRef(existingApp.id) }
    }
    if (existingApp?.status === 'PENDING') {
      return { outcome: 'existing_pending', applicationId: existingApp.id, ref: applicationRef(existingApp.id) }
    }

    const cohort = createTestCohortContext(data.phone)
    const providerId = await syncProviderRecord(tx, {
      phone: data.phone,
      name,
      email: data.email,
      skills: data.skills,
      serviceAreas: data.serviceAreas,
      active: true,
      availableNow: true,
      verified: false,
      isTestUser: cohort.isTestUser,
      cohortName: cohort.cohortName,
      locationNodeIds: data.locationNodeIds,
      avatarUrl: data.profilePhotoUrl,
      skipEnrichment: true,
    })

    const application = await tx.providerApplication.create({
      data: {
        providerId,
        phone: normalizeProviderApplicationPhone(data.phone),
        email: data.email,
        name,
        skills: data.skills,
        serviceAreas: data.serviceAreas,
        experience: data.experience,
        availability: data.availability,
        callOutFee: data.callOutFee,
        rateNegotiable: true,
        emergencyAvailable: data.emergencyAvailable,
        sameDayJobs: true,
        weekendJobs: hasWeekendAvailability(data.availabilityDays),
        evidenceNote: data.evidenceNote,
        evidenceFileUrls: input.evidenceFileUrls ?? [],
        isTestUser: cohort.isTestUser,
        cohortName: cohort.cohortName,
        status: 'PENDING',
      },
    })

    const categoryRows = data.skills.map((skill) => {
      const categorySlug = resolveServiceCategoryTag(skill) ?? skill
      return {
        providerId,
        categorySlug,
        yearsExperience: yearsExperienceFromLabel(data.experience),
        skillLevel: skillLevelFromExperienceLabel(data.experience),
        approvalStatus: 'PENDING_REVIEW',
        certificationRequired: false,
        certificationStatus: 'NOT_REQUIRED',
      }
    })

    if (categoryRows.length > 0) {
      await tx.providerCategory?.createMany?.({ data: categoryRows, skipDuplicates: true })
    }

    if (data.callOutFee !== null && categoryRows.length > 0) {
      await tx.providerRate?.createMany?.({
        data: categoryRows.map((row) => ({
          providerId,
          categorySlug: row.categorySlug,
          callOutFee: data.callOutFee,
          hourlyRate: null,
          rateNegotiable: true,
          quoteAfterInspection: false,
        })),
        skipDuplicates: true,
      })
    }

    if (data.locationNodeIds.length > 0) {
      await upsertStructuredServiceAreas(tx, providerId, data.locationNodeIds)
    }

    await tx.providerApplicationDraft.update({
      where: { id: input.draftId },
      data: { submittedApplicationId: application.id, lastCompletedStep: 8 },
    })
    await tx.registrationResumeToken.updateMany({
      where: { tokenHash },
      data: { consumedAt: new Date(), applicationId: application.id },
    })

    return { outcome: 'created', applicationId: application.id, ref: applicationRef(application.id) }
  })
}
