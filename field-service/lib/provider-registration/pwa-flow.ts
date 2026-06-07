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
import { normaliseLocationDisplayName, normaliseLocationDisplayNames } from '@/lib/location-format'
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
  registrationResumeToken: { updateMany: (...args: any[]) => Promise<unknown> }
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
> {
  const baseData = normalizeDraftInputBase({ ...input, lastCompletedStep: 8 })
  const name = cleanString(input.name)

  if (!name) {
    throw new ProviderRegistrationValidationError('Enter your full name.', 'MISSING_NAME')
  }
  if (!input.consentAccepted) {
    throw new ProviderRegistrationValidationError('Accept the provider terms before submitting.', 'CONSENT_REQUIRED')
  }

  const tokenHash = await hashRegistrationResumeToken(input.resumeToken)

  return client.$transaction(async (tx) => {
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
        evidenceFileUrls: [],
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
