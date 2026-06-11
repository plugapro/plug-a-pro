import { createHash, createHmac } from 'crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { decryptIdentifier } from '@/lib/identity-verification/crypto'
import type { DiditDecisionResponse } from '@/lib/identity-verification/vendors/didit/types'

const mocks = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(),
    providerIdentityDocument: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    providerIdentityVerification: {
      update: vi.fn(),
    },
    providerVerificationEvent: {
      create: vi.fn(),
    },
  }
  return {
    mockDb,
    mockFetch: vi.fn(),
    mockUploadIdentityDocument: vi.fn(),
  }
})

vi.mock('@/lib/db', () => ({ db: mocks.mockDb }))

vi.mock('@/lib/storage', () => ({
  uploadIdentityDocument: mocks.mockUploadIdentityDocument,
}))

import {
  downloadDocumentImage,
  extractImageRefs,
  isPersistableStatus,
  mapDecisionToVerificationFields,
  persistDiditDecision,
  redactPayload,
  toIdentityDocumentFile,
  tryMapDecisionToVerificationFields,
} from '@/lib/identity-verification/vendors/didit/persist'

const TEST_PEPPER = 'test-pepper'

function hmacIdentity(input: string, namespace: string): string {
  return createHmac('sha256', TEST_PEPPER)
    .update(`${namespace}:${input.replace(/\s+/g, '').trim().toUpperCase()}`)
    .digest('hex')
}

function fullDecision(): DiditDecisionResponse {
  return {
    session_id: 'sess_123',
    status: 'Approved',
    created_at: '2026-05-31T09:00:00.000Z',
    completed_at: '2026-05-31T09:05:00.000Z',
    person: {
      first_name: 'Jane',
      last_name: 'Citizen',
      date_of_birth: '1990-02-03',
      gender: 'FEMALE',
      personal_number: '900203 5000 088',
      citizenship: 'ZA',
      nationality: 'South African',
      address: '123 Secret Street',
      place_of_birth: 'Pretoria',
    },
    contact_details: {
      email: 'jane@example.test',
      phone: '+27123456789',
    },
    document: {
      number: 'A123456789',
      issuing_country: 'ZAF',
      expiration_date: '2031-04-05',
      front_image_url: 'https://didit.test/front.jpg?token=front-secret',
      back_image_url: 'https://didit.test/back.jpg?token=back-secret',
      document_file: 'https://didit.test/document-file.pdf?token=file-secret',
      formatted_address: '123 Secret Street, Pretoria',
      mrz_string: 'IDZAA123456789JANE<CITIZEN',
      parsed_address: {
        street_1: '123 Secret Street',
        street_2: 'Unit 4',
      },
      extra_files: ['https://didit.test/extra-file.jpg?token=extra-secret'],
    },
    document_images: [
      { kind: 'ID_FRONT', url: 'https://didit.test/front-from-list.jpg' },
      { kind: 'ID_BACK', url: 'https://didit.test/back-from-list.jpg' },
      { kind: 'PASSPORT_PHOTO_PAGE', url: 'https://didit.test/passport.jpg' },
    ],
    selfie: { image_url: 'https://didit.test/selfie.jpg?token=selfie-secret' },
    liveness: {
      frame_url: 'https://didit.test/liveness.jpg?token=liveness-secret',
      video_url: 'https://didit.test/liveness.mp4?token=video-secret',
    },
    id_verifications: [
      {
        status: 'Passed',
        score: 0.96,
        warnings: [{ risk_code: 'DOC_GLARE' }, { risk_code: 'DOC_GLARE' }],
      },
    ],
    liveness_checks: [
      {
        status: 'Passed',
        score: 0.92,
        warnings: [{ risk_code: 'LIVENESS_LOW_LIGHT' }],
      },
    ],
    face_matches: [{ status: 'Passed', score: 0.89 }],
    database_validations: [{ status: 'Passed', warnings: [{ risk_code: 'DHA_DELAYED' }] }],
  } as DiditDecisionResponse
}

describe('Didit decision persistence helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.mockFetch)
    process.env.DIDIT_API_KEY = 'didit-test-key'
    process.env.IDENTITY_HASH_PEPPER = TEST_PEPPER
    process.env.IDENTITY_ENC_KEY = '12345678901234567890123456789012'
    mocks.mockDb.$transaction.mockImplementation(async (callback) => callback(mocks.mockDb))
    mocks.mockDb.providerIdentityVerification.update.mockResolvedValue({ status: 'PASSED' })
    mocks.mockDb.providerVerificationEvent.create.mockResolvedValue({ id: 'event-1' })
    mocks.mockUploadIdentityDocument.mockResolvedValue({ pathname: 'supabase://identity-documents/identity/ver-1/ID_FRONT.jpg' })
  })

  it('treats only persisted verdict states as webhook-persistable', () => {
    expect(isPersistableStatus('PASSED')).toBe(true)
    expect(isPersistableStatus('FAILED')).toBe(true)
    expect(isPersistableStatus('NEEDS_MANUAL_REVIEW')).toBe(true)
    expect(isPersistableStatus('PROCESSING')).toBe(false)
    expect(isPersistableStatus('EXPIRED')).toBe(false)
    expect(isPersistableStatus('CANCELLED')).toBe(false)
  })

  it('maps Didit structured fields without storing raw document numbers', () => {
    const fields = mapDecisionToVerificationFields(fullDecision())

    expect(decryptIdentifier(fields.identifierEncrypted as string)).toBe('9002035000088')
    expect(fields.identifierHash).toBe(hmacIdentity('9002035000088', 'identity:SA_ID'))
    expect(fields.identifierLast4).toBe('0088')
    expect(fields.documentNumberHash).toBe(hmacIdentity('A123456789', 'document_number'))
    expect(fields.documentNumberLast4).toBe('6789')
    expect(JSON.stringify(fields)).not.toContain('A123456789')

    expect(fields.dobDerived).toEqual(new Date('1990-02-03T00:00:00.000Z'))
    expect(fields.genderDerived).toBe('FEMALE')
    expect(fields.citizenshipDerived).toBe('ZA')
    expect(fields.nationality).toBe('South African')
    expect(fields.issuingCountry).toBe('ZAF')
    expect(fields.documentExpiryDate).toEqual(new Date('2031-04-05T00:00:00.000Z'))
    expect(fields.documentConfidenceScore).toBe(0.96)
    expect(fields.livenessScore).toBe(0.92)
    expect(fields.selfieMatchScore).toBe(0.89)
    expect(fields.decisionAt).toEqual(new Date('2026-05-31T09:05:00.000Z'))
    expect(fields.riskFlags).toEqual(['DOC_GLARE', 'LIVENESS_LOW_LIGHT', 'DHA_DELAYED'])
  })

  it('maps the documented Didit v3 feature arrays and normalizes 0-100 scores', () => {
    const decision = {
      session_id: 'sess_v3',
      status: 'Approved',
      completed_at: '2026-05-31T09:05:00.000Z',
      id_verifications: [
        {
          status: 'Approved',
          document_number: 'CAA000000',
          personal_number: '99999999R',
          portrait_image: 'https://didit.test/portrait-v3.jpg',
          front_image: 'https://didit.test/front-v3.jpg',
          back_image: 'https://didit.test/back-v3.jpg',
          full_front_image: 'https://didit.test/full-front-v3.jpg',
          full_back_image: 'https://didit.test/full-back-v3.jpg',
          date_of_birth: '1980-01-01',
          expiration_date: '2031-06-02',
          issuing_state: 'ESP',
          gender: 'F',
          nationality: 'ESP',
          score: 85.2,
          front_image_quality_score: { overall_score: 88.7 },
          warnings: [{ risk: 'QR_NOT_DETECTED' }],
        },
      ],
      liveness_checks: [
        {
          status: 'Approved',
          score: 89.92,
          reference_image: 'https://didit.test/liveness-v3.jpg',
          warnings: [{ risk: 'LOW_LIVENESS_SCORE' }],
        },
      ],
      face_matches: [
        {
          status: 'In Review',
          score: 65.43,
          source_image: 'https://didit.test/face-source-v3.jpg',
          target_image: 'https://didit.test/face-target-v3.jpg',
          warnings: [{ risk: 'LOW_FACE_MATCH_SIMILARITY' }],
        },
      ],
    } as DiditDecisionResponse

    const fields = mapDecisionToVerificationFields(decision)

    expect(decryptIdentifier(fields.identifierEncrypted as string)).toBe('99999999R')
    expect(fields.identifierHash).toBe(hmacIdentity('99999999R', 'identity:SA_ID'))
    expect(fields.identifierLast4).toBe('999R')
    expect(fields.documentNumberHash).toBe(hmacIdentity('CAA000000', 'document_number'))
    expect(fields.documentNumberLast4).toBe('0000')
    expect(fields.dobDerived).toEqual(new Date('1980-01-01T00:00:00.000Z'))
    expect(fields.genderDerived).toBe('F')
    expect(fields.nationality).toBe('ESP')
    expect(fields.issuingCountry).toBe('ESP')
    expect(fields.documentExpiryDate).toEqual(new Date('2031-06-02T00:00:00.000Z'))
    expect(fields.documentConfidenceScore).toBeCloseTo(0.887)
    expect(fields.livenessScore).toBeCloseTo(0.8992)
    expect(fields.selfieMatchScore).toBeCloseTo(0.6543)
    expect(fields.riskFlags).toEqual(['QR_NOT_DETECTED', 'LOW_LIVENESS_SCORE', 'LOW_FACE_MATCH_SIMILARITY'])
    expect(extractImageRefs(decision)).toEqual([
      { kind: 'ID_FRONT', url: 'https://didit.test/front-v3.jpg' },
      { kind: 'ID_BACK', url: 'https://didit.test/back-v3.jpg' },
      { kind: 'SELFIE', url: 'https://didit.test/portrait-v3.jpg' },
      { kind: 'LIVENESS_FRAME', url: 'https://didit.test/liveness-v3.jpg' },
    ])
  })

  it('leaves score fields unset when Didit omits numeric scores', () => {
    const fields = mapDecisionToVerificationFields({
      session_id: 'sess_missing_scores',
      status: 'Approved',
      id_verifications: [{ status: 'Passed' }],
      liveness_checks: [{ status: 'Passed' }],
      face_matches: [{ status: 'Passed' }],
    } as DiditDecisionResponse)

    expect(fields.documentConfidenceScore).toBeUndefined()
    expect(fields.livenessScore).toBeUndefined()
    expect(fields.selfieMatchScore).toBeUndefined()
  })

  it('does not substitute explicitly excluded Didit artifacts for the four stored image kinds', () => {
    const refs = extractImageRefs({
      session_id: 'sess_excluded',
      status: 'Approved',
      id_verifications: [
        {
          status: 'Approved',
          full_front_image: 'https://didit.test/full-front.jpg',
          full_back_image: 'https://didit.test/full-back.jpg',
          front_image_camera_front: 'https://didit.test/front-camera.jpg',
          back_image_camera_front: 'https://didit.test/back-camera.jpg',
          front_video: 'https://didit.test/front.mp4',
          back_video: 'https://didit.test/back.mp4',
        },
      ],
      face_matches: [
        {
          status: 'Approved',
          source_image: 'https://didit.test/face-source.jpg',
          target_image: 'https://didit.test/face-target.jpg',
        },
      ],
      liveness_checks: [
        {
          status: 'Approved',
          video_url: 'https://didit.test/liveness.mp4',
        },
      ],
    } as DiditDecisionResponse)

    expect(refs).toEqual([])
  })

  it('returns a shape mismatch instead of throwing from the safe mapper', () => {
    const result = tryMapDecisionToVerificationFields({ status: 'Approved' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/session_id/)
    }
  })

  it('extracts only the four Didit image kinds stored locally', () => {
    expect(extractImageRefs(fullDecision())).toEqual([
      { kind: 'ID_FRONT', url: 'https://didit.test/front.jpg?token=front-secret' },
      { kind: 'ID_BACK', url: 'https://didit.test/back.jpg?token=back-secret' },
      { kind: 'SELFIE', url: 'https://didit.test/selfie.jpg?token=selfie-secret' },
      { kind: 'LIVENESS_FRAME', url: 'https://didit.test/liveness.jpg?token=liveness-secret' },
    ])
  })

  it('redacts image and video URLs and replaces PII with stable hash tokens', () => {
    const redacted = redactPayload(fullDecision())
    const text = JSON.stringify(redacted)

    expect(text).not.toContain('front-secret')
    expect(text).not.toContain('file-secret')
    expect(text).not.toContain('extra-secret')
    expect(text).not.toContain('selfie-secret')
    expect(text).not.toContain('liveness.mp4')
    expect(text).not.toContain('900203')
    expect(text).not.toContain('A123456789')
    expect(text).not.toContain('123 Secret Street')
    expect(text).not.toContain('Unit 4')
    expect(text).not.toContain('Pretoria')
    expect(text).not.toContain('jane@example.test')
    expect(text).not.toContain('+27123456789')
    expect(text).not.toContain('IDZAA123456789JANE')
    expect(text).toMatch(/<HASH:[a-f0-9]{8}>/)
    expect(text).toContain(`<HASH:${createHmac('sha256', TEST_PEPPER).update('Jane').digest('hex').slice(0, 8)}>`)
    expect(redacted).toMatchObject({
      session_id: 'sess_123',
      status: 'Approved',
      document: {
        front_image_url: '[REDACTED_URL]',
        back_image_url: '[REDACTED_URL]',
      },
      selfie: { image_url: '[REDACTED_URL]' },
      liveness: {
        frame_url: '[REDACTED_URL]',
        video_url: '[REDACTED_URL]',
      },
    })
  })

  it('redacts the callback magic link and unlisted url/token/link fields while preserving benign metadata', () => {
    const redacted = redactPayload({
      session_id: 'sess_callback',
      status: 'Approved',
      callback: 'https://plug.test/provider/verify/secret-token-123/liveness/complete',
      document: {
        file_url: 'https://didit.test/file.jpg?token=file-url-secret',
        download_url: 'https://didit.test/download?token=download-secret',
        media_url: 'https://didit.test/media.mp4?token=media-secret',
        document_link: 'https://didit.test/doc?token=doc-link-secret',
        session_token: 'tok-abcdef',
        result_href: 'https://didit.test/result',
        return_redirect: 'https://didit.test/return',
        files: ['https://didit.test/extra1.jpg?token=files-secret', 'https://didit.test/extra2.jpg'],
        file_extension: 'jpg',
        link_id: 'didit-link-123',
      },
    }) as {
      callback: string
      document: {
        file_url: string
        download_url: string
        media_url: string
        document_link: string
        session_token: string
        result_href: string
        return_redirect: string
        files: string[]
        file_extension: string
        link_id: string
      }
    }

    expect(redacted.callback).toBe('[REDACTED_URL]')
    expect(redacted.document.file_url).toBe('[REDACTED_URL]')
    expect(redacted.document.download_url).toBe('[REDACTED_URL]')
    expect(redacted.document.media_url).toBe('[REDACTED_URL]')
    expect(redacted.document.document_link).toBe('[REDACTED_URL]')
    expect(redacted.document.session_token).toBe('[REDACTED_URL]')
    expect(redacted.document.result_href).toBe('[REDACTED_URL]')
    expect(redacted.document.return_redirect).toBe('[REDACTED_URL]')
    expect(redacted.document.files).toEqual(['[REDACTED_URL]', '[REDACTED_URL]'])
    expect(redacted.document.file_extension).toBe('jpg')
    expect(redacted.document.link_id).toBe('didit-link-123')
    const text = JSON.stringify(redacted)
    expect(text).not.toContain('secret-token-123')
    expect(text).not.toContain('file-url-secret')
    expect(text).not.toContain('download-secret')
    expect(text).not.toContain('media-secret')
    expect(text).not.toContain('doc-link-secret')
    expect(text).not.toContain('tok-abcdef')
    expect(text).not.toContain('files-secret')
  })

  it('preserves non-URL quality metadata and unrelated number fields in the redacted payload', () => {
    const redacted = redactPayload({
      session_id: 'sess_quality',
      document: {
        number: 'DOC-123456',
        full_front_image: 'https://didit.test/full-front.jpg?token=secret',
        front_image_quality_score: {
          overall_score: 0.87,
          brightness_issue: false,
        },
        image_quality_score: {
          focus: 0.91,
        },
        file_extension: 'jpg',
        link_id: 'didit-link-123',
      },
      attempt: {
        number: 'attempt-2',
      },
      id_verifications: [
        {
          front_video: 'https://didit.test/front-video.mp4?token=secret',
          image_quality_score: {
            focus: 0.76,
            is_document_fully_visible: true,
          },
        },
      ],
    }) as {
      document: {
        number: string
        full_front_image: string
        front_image_quality_score: { overall_score: number; brightness_issue: boolean }
        image_quality_score: { focus: number }
        file_extension: string
        link_id: string
      }
      attempt: { number: string }
      id_verifications: Array<{
        front_video: string
        image_quality_score: { focus: number; is_document_fully_visible: boolean }
      }>
    }

    expect(redacted.document.number).toMatch(/^<HASH:[a-f0-9]{8}>$/)
    expect(redacted.document.full_front_image).toBe('[REDACTED_URL]')
    expect(redacted.id_verifications[0].front_video).toBe('[REDACTED_URL]')
    expect(redacted.document.front_image_quality_score).toEqual({
      overall_score: 0.87,
      brightness_issue: false,
    })
    expect(redacted.document.image_quality_score).toEqual({ focus: 0.91 })
    expect(redacted.id_verifications[0].image_quality_score).toEqual({
      focus: 0.76,
      is_document_fully_visible: true,
    })
    expect(redacted.document.file_extension).toBe('jpg')
    expect(redacted.document.link_id).toBe('didit-link-123')
    expect(redacted.attempt.number).toBe('attempt-2')
    expect(JSON.stringify(redacted)).not.toContain('token=secret')
  })
})

describe('Didit document persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.mockFetch)
    process.env.DIDIT_API_KEY = 'didit-test-key'
    process.env.IDENTITY_HASH_PEPPER = TEST_PEPPER
    process.env.IDENTITY_ENC_KEY = '12345678901234567890123456789012'
    mocks.mockDb.$transaction.mockImplementation(async (callback) => callback(mocks.mockDb))
    mocks.mockDb.providerIdentityVerification.update.mockResolvedValue({ status: 'PASSED' })
    mocks.mockDb.providerVerificationEvent.create.mockResolvedValue({ id: 'event-1' })
    mocks.mockUploadIdentityDocument.mockResolvedValue({ pathname: 'supabase://identity-documents/identity/ver-1/uploaded.jpg' })
  })

  it('downloads a Didit image and preserves sha256, MIME type and bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    mocks.mockFetch.mockResolvedValueOnce(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg; charset=binary' },
    }))

    const downloaded = await downloadDocumentImage({
      kind: 'ID_FRONT',
      url: 'https://didit.test/front.jpg',
    })

    expect(downloaded).toMatchObject({
      kind: 'ID_FRONT',
      url: 'https://didit.test/front.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 4,
      sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    })
    await expect(toIdentityDocumentFile(downloaded).arrayBuffer()).resolves.toEqual(bytes.buffer)
  })

  it('retries a 401 download once with lowercase x-api-key', async () => {
    mocks.mockFetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([5]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))

    await expect(downloadDocumentImage({
      kind: 'ID_BACK',
      url: 'https://didit.test/back.png',
    })).resolves.toMatchObject({ kind: 'ID_BACK', mimeType: 'image/png' })

    expect(mocks.mockFetch).toHaveBeenCalledTimes(2)
    expect(mocks.mockFetch.mock.calls[0][1]?.headers).toMatchObject({ 'X-Api-Key': 'didit-test-key' })
    expect(mocks.mockFetch.mock.calls[1][1]?.headers).toMatchObject({ 'x-api-key': 'didit-test-key' })
  })

  it('skips upload and document DB writes when the active row already has the same sha256', async () => {
    const bytes = new Uint8Array([9, 9, 9])
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    mocks.mockFetch.mockResolvedValueOnce(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce({ id: 'doc-front', sha256 })

    const result = await persistDiditDecision('ver-1', decisionWithImages({ front: 'https://didit.test/front.jpg' }), {
      source: 'webhook',
    })

    expect(result.documentsSkipped).toEqual(['ID_FRONT'])
    expect(result.documentsStored).toEqual([])
    expect(mocks.mockUploadIdentityDocument).not.toHaveBeenCalled()
    expect(mocks.mockDb.providerIdentityDocument.update).not.toHaveBeenCalled()
    expect(mocks.mockDb.providerIdentityDocument.create).not.toHaveBeenCalled()
  })

  it('uploads and queues an update when an active document row has a changed sha256', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    mocks.mockFetch.mockResolvedValueOnce(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-front',
      sha256: 'old-sha',
    })
    mocks.mockUploadIdentityDocument.mockResolvedValueOnce({
      pathname: 'supabase://identity-documents/identity/ver-1/front-new.jpg',
    })

    const result = await persistDiditDecision('ver-1', decisionWithImages({ front: 'https://didit.test/front.jpg' }), {
      source: 'webhook',
    })

    expect(result.documentsStored).toEqual(['ID_FRONT'])
    expect(mocks.mockUploadIdentityDocument).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      documentKind: 'ID_FRONT',
      file: expect.any(File),
    })
    expect(mocks.mockDb.providerIdentityDocument.update).toHaveBeenCalledWith({
      where: { id: 'doc-front' },
      data: expect.objectContaining({
        blobKey: 'supabase://identity-documents/identity/ver-1/front-new.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 3,
        sha256,
        status: 'UPLOADED',
      }),
    })
  })

  it('uploads and queues a create when there is no active document row', async () => {
    const bytes = new Uint8Array([7, 7])
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    mocks.mockFetch.mockResolvedValueOnce(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce(null)
    mocks.mockUploadIdentityDocument.mockResolvedValueOnce({
      pathname: 'supabase://identity-documents/identity/ver-1/selfie.png',
    })

    const result = await persistDiditDecision('ver-1', decisionWithImages({ selfie: 'https://didit.test/selfie.png' }), {
      source: 'webhook',
    })

    expect(result.documentsStored).toEqual(['SELFIE'])
    expect(mocks.mockDb.providerIdentityDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        documentKind: 'SELFIE',
        blobKey: 'supabase://identity-documents/identity/ver-1/selfie.png',
        mimeType: 'image/png',
        sizeBytes: 2,
        sha256,
        status: 'UPLOADED',
      }),
    })
  })

  it('isolates per-kind download failures in documentsFailed', async () => {
    mocks.mockFetch
      .mockResolvedValueOnce(new Response('gone', { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([8]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce(null)

    const result = await persistDiditDecision('ver-1', decisionWithImages({
      front: 'https://didit.test/front-missing.jpg',
      selfie: 'https://didit.test/selfie.jpg',
    }), {
      source: 'webhook',
    })

    expect(result.documentsStored).toEqual(['SELFIE'])
    expect(result.documentsFailed).toEqual([
      { kind: 'ID_FRONT', reason: expect.stringContaining('Didit image download failed') },
    ])
    expect(mocks.mockDb.providerIdentityDocument.create).toHaveBeenCalledTimes(1)
  })

  it('stamps fields, writes the redacted payload, stores documents and writes one provider event', async () => {
    const bytes = new Uint8Array([4, 3, 2, 1])
    mocks.mockFetch.mockResolvedValueOnce(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce(null)
    mocks.mockUploadIdentityDocument.mockResolvedValueOnce({
      pathname: 'supabase://identity-documents/identity/ver-1/front.jpg',
    })

    const result = await persistDiditDecision('ver-1', decisionWithImages({
      front: 'https://didit.test/front.jpg',
    }, fullDecision()), {
      source: 'webhook',
    })

    expect(result).toMatchObject({
      verificationId: 'ver-1',
      fieldsStamped: true,
      payloadRedacted: true,
      documentsStored: ['ID_FRONT'],
      documentsSkipped: [],
      documentsFailed: [],
    })
    expect(mocks.mockDb.providerIdentityVerification.update).toHaveBeenCalledWith({
      where: { id: 'ver-1' },
      data: expect.objectContaining({
        identifierEncrypted: expect.any(String),
        identifierHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        documentNumberHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        rawPayloadRedacted: expect.any(Object),
      }),
      select: { status: true },
    })
    expect(mocks.mockDb.providerVerificationEvent.create).toHaveBeenCalledTimes(1)
    expect(mocks.mockDb.providerVerificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        fromStatus: 'PASSED',
        toStatus: 'PASSED',
        reasonCode: 'DIDIT_PERSIST_COMPLETED',
        metadata: expect.objectContaining({
          source: 'webhook',
          fieldsStamped: true,
          payloadRedacted: true,
          documentsStored: ['ID_FRONT'],
          documentsSkipped: [],
          documentsFailed: [],
        }),
      }),
    })
  })

  it('still writes redacted payload and successful documents when field mapping has a shape mismatch', async () => {
    mocks.mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([6]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce(null)

    const result = await persistDiditDecision('ver-1', {
      status: 'Approved',
      document: { front_image_url: 'https://didit.test/front.jpg', number: 'DOC-PII' },
    } as unknown as DiditDecisionResponse, {
      source: 'admin_refresh',
    })

    expect(result.fieldsStamped).toBe(false)
    expect(result.documentsStored).toEqual(['ID_FRONT'])
    expect(mocks.mockDb.providerIdentityVerification.update).toHaveBeenCalledWith({
      where: { id: 'ver-1' },
      data: {
        rawPayloadRedacted: expect.objectContaining({
          status: 'Approved',
          document: expect.objectContaining({
            front_image_url: '[REDACTED_URL]',
            number: expect.stringMatching(/^<HASH:[a-f0-9]{8}>$/),
          }),
        }),
      },
      select: { status: true },
    })
    expect(mocks.mockDb.providerVerificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reasonCode: 'DIDIT_PERSIST_SHAPE_MISMATCH',
        metadata: expect.objectContaining({
          source: 'admin_refresh',
          fieldsStamped: false,
          payloadRedacted: true,
          documentsStored: ['ID_FRONT'],
          mappingError: expect.stringContaining('session_id'),
        }),
      }),
    })
  })

  it('rejects when the DB transaction fails', async () => {
    mocks.mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([3]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }))
    mocks.mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce(null)
    mocks.mockDb.$transaction.mockRejectedValueOnce(new Error('tx exploded'))

    await expect(persistDiditDecision('ver-1', decisionWithImages({
      front: 'https://didit.test/front.jpg',
    }), {
      source: 'webhook',
    })).rejects.toThrow('tx exploded')
  })
})

function decisionWithImages(images: {
  front?: string
  back?: string
  selfie?: string
  liveness?: string
}, base: DiditDecisionResponse = {
  session_id: 'sess_images',
  status: 'Approved',
  created_at: '2026-05-31T09:00:00.000Z',
  completed_at: '2026-05-31T09:05:00.000Z',
} as DiditDecisionResponse): DiditDecisionResponse {
  return {
    ...base,
    document: {
      ...((base.document && typeof base.document === 'object') ? base.document : {}),
      front_image_url: images.front,
      back_image_url: images.back,
    },
    selfie: {
      ...((base.selfie && typeof base.selfie === 'object') ? base.selfie : {}),
      image_url: images.selfie,
    },
    liveness: {
      ...((base.liveness && typeof base.liveness === 'object') ? base.liveness : {}),
      frame_url: images.liveness,
    },
  } as DiditDecisionResponse
}
