import { createHash, createHmac } from 'crypto'

import type { Prisma, VerificationStatus } from '@prisma/client'

import { db } from '../../../db'
import { uploadIdentityDocument } from '../../../storage'
import {
  encryptIdentifier,
  hashIdentifier,
  identifierLast4,
  normalizeIdentifier,
} from '../../crypto'
import type { DiditDecisionResponse, DiditFeatureCheck } from './types'

const DIDIT_STORED_IMAGE_KINDS = ['ID_FRONT', 'ID_BACK', 'SELFIE', 'LIVENESS_FRAME'] as const
const PERSISTABLE_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  'PASSED',
  'FAILED',
  'NEEDS_MANUAL_REVIEW',
])
const RAW_DOCUMENT_RETENTION_DAYS = 60
const URL_KEY_PATTERN = /(url|uri|href|link|image|video|file)/i
const PII_KEYS = new Set([
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'full_name',
  'fullName',
  'name',
  'date_of_birth',
  'dateOfBirth',
  'dob',
  'birth_date',
  'birthDate',
  'street_1',
  'street_2',
  'street1',
  'street2',
  'address',
  'formatted_address',
  'formattedAddress',
  'place_of_birth',
  'placeOfBirth',
  'email',
  'email_address',
  'emailAddress',
  'phone',
  'phone_number',
  'phoneNumber',
  'full_number',
  'fullNumber',
  'personal_number',
  'personalNumber',
  'national_id',
  'nationalId',
  'id_number',
  'idNumber',
  'document_number',
  'documentNumber',
  'mrz_string',
  'mrzString',
  'mrz_key',
  'mrzKey',
  'serial_number',
  'serialNumber',
  'number',
])

export type DiditStoredImageKind = typeof DIDIT_STORED_IMAGE_KINDS[number]

export type DiditImageRef = {
  kind: DiditStoredImageKind
  url: string
}

export type DownloadedDiditImage = DiditImageRef & {
  bytes: Uint8Array
  mimeType: string
  sizeBytes: number
  sha256: string
}

export type DiditVerificationFieldUpdate = Pick<
  Prisma.ProviderIdentityVerificationUpdateInput,
  | 'identifierEncrypted'
  | 'identifierHash'
  | 'identifierLast4'
  | 'documentNumberHash'
  | 'documentNumberLast4'
  | 'documentExpiryDate'
  | 'dobDerived'
  | 'genderDerived'
  | 'citizenshipDerived'
  | 'nationality'
  | 'issuingCountry'
  | 'documentConfidenceScore'
  | 'livenessScore'
  | 'selfieMatchScore'
  | 'decisionAt'
  | 'riskFlags'
>

export type PersistResult = {
  verificationId: string
  fieldsStamped: boolean
  payloadRedacted: boolean
  documentsStored: DiditStoredImageKind[]
  documentsSkipped: DiditStoredImageKind[]
  documentsFailed: Array<{ kind: DiditStoredImageKind; reason: string }>
}

type QueuedDocumentWrite = {
  kind: DiditStoredImageKind
  run: (tx: Prisma.TransactionClient) => Promise<unknown>
}

export function isPersistableStatus(status: VerificationStatus): boolean {
  return PERSISTABLE_STATUSES.has(status)
}

export function mapDecisionToVerificationFields(decision: DiditDecisionResponse): DiditVerificationFieldUpdate {
  assertDiditDecisionShape(decision)

  const person = readRecord(decision.person)
  const document = readRecord(decision.document)
  const idVerification = readRecord(firstFeature(decision.id_verifications))
  const nfcVerification = readRecord(firstFeature((decision as { nfc_verifications?: DiditFeatureCheck[] }).nfc_verifications))
  const nfcChipData = readRecord(nfcVerification?.chip_data)
  const mrz = readRecord(idVerification?.mrz)
  const personalNumber = firstString(
    idVerification?.personal_number,
    idVerification?.personalNumber,
    nfcChipData?.personal_number,
    nfcChipData?.personalNumber,
    mrz?.personal_number,
    mrz?.personalNumber,
    person?.personal_number,
    person?.personalNumber,
    person?.national_id,
    person?.nationalId,
    person?.id_number,
    person?.idNumber,
    decision.personal_number,
    decision.personalNumber,
  )
  const documentNumber = firstString(
    idVerification?.document_number,
    idVerification?.documentNumber,
    nfcChipData?.document_number,
    nfcChipData?.documentNumber,
    mrz?.document_number,
    mrz?.documentNumber,
    document?.number,
    document?.document_number,
    document?.documentNumber,
    decision.document_number,
    decision.documentNumber,
  )
  const fields: DiditVerificationFieldUpdate = {
    dobDerived: parseDateOnly(firstString(
      idVerification?.date_of_birth,
      idVerification?.dateOfBirth,
      nfcChipData?.date_of_birth,
      nfcChipData?.dateOfBirth,
      nfcChipData?.birth_date,
      nfcChipData?.birthDate,
      person?.date_of_birth,
      person?.dateOfBirth,
      person?.dob,
      decision.date_of_birth,
      decision.dateOfBirth,
    )),
    genderDerived: firstString(idVerification?.gender, nfcChipData?.gender, mrz?.sex, person?.gender, decision.gender),
    citizenshipDerived: firstString(
      idVerification?.citizenship,
      nfcChipData?.citizenship,
      person?.citizenship,
      decision.citizenship,
    ),
    nationality: firstString(idVerification?.nationality, nfcChipData?.nationality, mrz?.nationality, person?.nationality, decision.nationality),
    issuingCountry: firstString(
      idVerification?.issuing_country,
      idVerification?.issuingCountry,
      idVerification?.issuing_state,
      idVerification?.issuingState,
      nfcChipData?.issuing_country,
      nfcChipData?.issuingCountry,
      nfcChipData?.issuing_state,
      nfcChipData?.issuingState,
      mrz?.country,
      document?.issuing_country,
      document?.issuingCountry,
      document?.country,
      decision.issuing_country,
      decision.issuingCountry,
    ),
    documentExpiryDate: parseDateOnly(firstString(
      idVerification?.expiration_date,
      idVerification?.expirationDate,
      idVerification?.expiry_date,
      idVerification?.expiryDate,
      nfcChipData?.expiration_date,
      nfcChipData?.expirationDate,
      nfcChipData?.expiry_date,
      nfcChipData?.expiryDate,
      document?.expiration_date,
      document?.expirationDate,
      document?.expiry_date,
      document?.expiryDate,
      decision.document_expiry_date,
      decision.documentExpiryDate,
    )),
    documentConfidenceScore: documentConfidenceScore(firstFeature(decision.id_verifications)),
    livenessScore: numericScore(firstFeature(decision.liveness_checks)),
    selfieMatchScore: numericScore(firstFeature(decision.face_matches)),
    decisionAt: parseDateTime(firstString(decision.completed_at, decision.decision_at, decision.updated_at, decision.created_at)),
    riskFlags: collectRiskFlags(decision) as Prisma.InputJsonValue,
  }

  if (personalNumber) {
    const normalized = normalizeIdentifier(personalNumber)
    fields.identifierEncrypted = encryptIdentifier(normalized)
    fields.identifierHash = hashIdentifier(normalized, 'identity:SA_ID')
    fields.identifierLast4 = identifierLast4(normalized)
  }

  if (documentNumber) {
    const normalized = normalizeIdentifier(documentNumber)
    fields.documentNumberHash = hashIdentifier(normalized, 'document_number')
    fields.documentNumberLast4 = identifierLast4(normalized)
  }

  return compactUndefined(fields)
}

export function tryMapDecisionToVerificationFields(
  value: unknown,
): { ok: true; fields: DiditVerificationFieldUpdate } | { ok: false; error: string } {
  try {
    return { ok: true, fields: mapDecisionToVerificationFields(value as DiditDecisionResponse) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function extractImageRefs(decision: DiditDecisionResponse): DiditImageRef[] {
  const document = readRecord(decision.document)
  const selfie = readRecord(decision.selfie)
  const liveness = readRecord(decision.liveness)
  const idVerification = readRecord(firstFeature(decision.id_verifications))
  const livenessCheck = readRecord(firstFeature(decision.liveness_checks))

  return [
    {
      kind: 'ID_FRONT',
      url: firstString(
        document?.front_image_url,
        document?.frontImageUrl,
        idVerification?.front_image,
        idVerification?.frontImage,
        decision.id_front_url,
      ),
    },
    {
      kind: 'ID_BACK',
      url: firstString(
        document?.back_image_url,
        document?.backImageUrl,
        idVerification?.back_image,
        idVerification?.backImage,
        decision.id_back_url,
      ),
    },
    {
      kind: 'SELFIE',
      url: firstString(
        selfie?.image_url,
        selfie?.imageUrl,
        idVerification?.portrait_image,
        idVerification?.portraitImage,
        decision.selfie_url,
      ),
    },
    {
      kind: 'LIVENESS_FRAME',
      url: firstString(
        liveness?.frame_url,
        liveness?.frameUrl,
        livenessCheck?.reference_image,
        livenessCheck?.referenceImage,
        decision.liveness_frame_url,
      ),
    },
  ].filter((ref): ref is DiditImageRef => Boolean(ref.url))
}

export function redactPayload(value: unknown): Prisma.InputJsonValue {
  return redactValue(value, null) as Prisma.InputJsonValue
}

export class DiditImageDownloadError extends Error {
  constructor(
    public readonly kind: DiditStoredImageKind,
    public readonly url: string,
    public readonly status: number,
    responseBody: string,
  ) {
    super(`Didit image download failed for ${kind}: HTTP ${status} ${responseBody.slice(0, 120)}`.trim())
    this.name = 'DiditImageDownloadError'
  }
}

export async function downloadDocumentImage(ref: DiditImageRef): Promise<DownloadedDiditImage> {
  const apiKey = process.env.DIDIT_API_KEY?.trim()
  const headers = apiKey ? { 'X-Api-Key': apiKey } : undefined
  let response = await fetch(ref.url, { headers })

  // Didit image endpoints may reject the canonical header casing even when the
  // API key is valid, so retry a 401 once with the documented lowercase form.
  if (response.status === 401 && apiKey) {
    response = await fetch(ref.url, { headers: { 'x-api-key': apiKey } })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new DiditImageDownloadError(ref.kind, ref.url, response.status, body)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return {
    ...ref,
    bytes: new Uint8Array(buffer),
    mimeType: contentType(response.headers.get('content-type')),
    sizeBytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

export function toIdentityDocumentFile(image: DownloadedDiditImage): File {
  const body = new ArrayBuffer(image.bytes.byteLength)
  new Uint8Array(body).set(image.bytes)
  return new File([body], `${image.kind.toLowerCase()}.${extensionForMimeType(image.mimeType)}`, {
    type: image.mimeType,
  })
}

export async function persistDiditDecision(
  verificationId: string,
  decision: DiditDecisionResponse,
  options: { source: 'webhook' | 'admin_refresh' },
): Promise<PersistResult> {
  const mapped = tryMapDecisionToVerificationFields(decision)
  const redacted = redactPayload(decision)
  const documentsStored: DiditStoredImageKind[] = []
  const documentsSkipped: DiditStoredImageKind[] = []
  const documentsFailed: Array<{ kind: DiditStoredImageKind; reason: string }> = []
  const documentWrites: QueuedDocumentWrite[] = []

  for (const ref of extractImageRefs(decision)) {
    try {
      const downloaded = await downloadDocumentImage(ref)
      const queued = await queueDocumentWrite(verificationId, downloaded)
      if (queued.action === 'skip') {
        documentsSkipped.push(ref.kind)
      } else {
        documentsStored.push(ref.kind)
        documentWrites.push(queued.write)
      }
    } catch (error) {
      documentsFailed.push({
        kind: ref.kind,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.providerIdentityVerification.update({
      where: { id: verificationId },
      data: {
        ...(mapped.ok ? mapped.fields : {}),
        rawPayloadRedacted: redacted,
      },
      select: { status: true },
    })

    for (const write of documentWrites) {
      await write.run(tx)
    }

    await tx.providerVerificationEvent.create({
      data: {
        verificationId,
        fromStatus: updated.status,
        toStatus: updated.status,
        reasonCode: mapped.ok ? 'DIDIT_PERSIST_COMPLETED' : 'DIDIT_PERSIST_SHAPE_MISMATCH',
        metadata: {
          source: options.source,
          fieldsStamped: mapped.ok,
          payloadRedacted: true,
          documentsStored,
          documentsSkipped,
          documentsFailed,
          ...(mapped.ok ? {} : { mappingError: mapped.error }),
        } as Prisma.InputJsonValue,
      },
    })
  })

  return {
    verificationId,
    fieldsStamped: mapped.ok,
    payloadRedacted: true,
    documentsStored,
    documentsSkipped,
    documentsFailed,
  }
}

function assertDiditDecisionShape(value: unknown): asserts value is DiditDecisionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Didit decision must be an object')
  }
  const sessionId = (value as Record<string, unknown>).session_id
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('Didit decision is missing session_id')
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseDateTime(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function firstFeature(features: DiditFeatureCheck[] | undefined): DiditFeatureCheck | null {
  return Array.isArray(features) && features.length > 0 ? features[0] : null
}

function numericScore(feature: DiditFeatureCheck | null): number | undefined {
  if (!feature) return undefined
  if (typeof feature.score === 'number') return normalizeScore(feature.score)
  if (feature.status === 'Passed') return 1.0
  return undefined
}

function numericScoreWithFallback(feature: DiditFeatureCheck | null, fallbackKey: 'confidence' | 'score'): number | undefined {
  if (!feature) return undefined
  const score = numericScore(feature)
  if (score !== undefined) return score
  return typeof feature[fallbackKey] === 'number' ? normalizeScore(feature[fallbackKey] as number) : undefined
}

function documentConfidenceScore(feature: DiditFeatureCheck | null): number | undefined {
  if (!feature) return undefined
  const frontImageQualityScore = readRecord(feature.front_image_quality_score)
  const overallScore = frontImageQualityScore?.overall_score
  if (typeof overallScore === 'number') return normalizeScore(overallScore)
  return numericScoreWithFallback(feature, 'confidence')
}

function normalizeScore(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return value > 1 && value <= 100 ? value / 100 : value
}

function collectRiskFlags(decision: DiditDecisionResponse): string[] {
  const flags = new Set<string>()
  for (const key of ['id_verifications', 'liveness_checks', 'face_matches', 'aml_screenings', 'database_validations', 'nfc_verifications'] as const) {
    const features = decision[key]
    if (!Array.isArray(features)) continue
    for (const feature of features) {
      if (!Array.isArray(feature.warnings)) continue
      for (const warning of feature.warnings) {
        if (typeof warning?.risk_code === 'string' && warning.risk_code.trim()) {
          flags.add(warning.risk_code.trim())
        }
        if (typeof warning?.risk === 'string' && warning.risk.trim()) {
          flags.add(warning.risk.trim())
        }
      }
    }
  }
  return [...flags]
}

function compactUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined),
  ) as T
}

function redactValue(value: unknown, key: string | null): unknown {
  if (Array.isArray(value)) return value.map(item => redactValue(item, null))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && key && PII_KEYS.has(key)) return hashToken(value)
    return value
  }

  const out: Record<string, unknown> = {}
  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (URL_KEY_PATTERN.test(nestedKey)) {
      out[nestedKey] = '[REDACTED_URL]'
      continue
    }
    if (PII_KEYS.has(nestedKey) && typeof nestedValue === 'string') {
      out[nestedKey] = hashToken(nestedValue)
      continue
    }
    out[nestedKey] = redactValue(nestedValue, nestedKey)
  }
  return out
}

function hashToken(value: string): string {
  const pepper = process.env.IDENTITY_HASH_PEPPER
  if (!pepper) {
    throw new Error('IDENTITY_HASH_PEPPER is required for Didit payload redaction')
  }
  const digest = createHmac('sha256', pepper).update(value).digest('hex').slice(0, 8)
  return `<HASH:${digest}>`
}

async function queueDocumentWrite(
  verificationId: string,
  image: DownloadedDiditImage,
): Promise<
  | { action: 'skip' }
  | { action: 'write'; write: QueuedDocumentWrite }
> {
  const existing = await db.providerIdentityDocument.findFirst({
    where: {
      verificationId,
      documentKind: image.kind,
      status: { not: 'DELETED' },
    },
    select: { id: true, sha256: true },
  })

  if (existing?.sha256 === image.sha256) {
    return { action: 'skip' }
  }

  const file = toIdentityDocumentFile(image)
  const uploaded = await uploadIdentityDocument({
    verificationId,
    documentKind: image.kind,
    file,
  })
  const documentData = {
    blobKey: uploaded.pathname,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    sha256: image.sha256,
    status: 'UPLOADED' as const,
    deleteAfter: addDays(new Date(), RAW_DOCUMENT_RETENTION_DAYS),
  }

  if (existing) {
    return {
      action: 'write',
      write: {
        kind: image.kind,
        run: (tx) => tx.providerIdentityDocument.update({
          where: { id: existing.id },
          data: documentData,
        }),
      },
    }
  }

  return {
    action: 'write',
    write: {
      kind: image.kind,
      run: (tx) => tx.providerIdentityDocument.create({
        data: {
          verificationId,
          documentKind: image.kind,
          ...documentData,
        },
      }),
    },
  }
}

function contentType(value: string | null): string {
  return value?.split(';')[0]?.trim() || 'application/octet-stream'
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'jpg'
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}
