// SEC-01 / P0-7: pure selection/verification logic for the idNumber
// encryption backfill + plaintext retirement scripts. Neither script is ever
// executed here — only the exported pure functions are tested.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import {
  classifyBackfillRow,
  encryptAndVerify,
  planBackfill,
  type BackfillRow,
} from '../../scripts/backfill-id-number-encryption'
import {
  canExecuteRetirement,
  classifyRetireRow,
  planRetirement,
  type RetireRow,
} from '../../scripts/retire-plaintext-id-numbers'
import { PII_ENC_KEY_ENV, decryptIdNumber, encryptIdNumber } from '@/lib/pii-crypto'

const TEST_KEY = Buffer.alloc(32, 5).toString('base64')
const ORIGINAL_KEY = process.env[PII_ENC_KEY_ENV]
const SAMPLE_ID = '8001015009087'

beforeEach(() => {
  process.env[PII_ENC_KEY_ENV] = TEST_KEY
})

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env[PII_ENC_KEY_ENV]
  else process.env[PII_ENC_KEY_ENV] = ORIGINAL_KEY
})

// ─── Backfill selection ───────────────────────────────────────────────────────

describe('backfill classification', () => {
  it('selects rows with plaintext and no ciphertext', () => {
    expect(classifyBackfillRow({ id: 'a', idNumber: SAMPLE_ID, idNumberCiphertext: null })).toBe('needs_encryption')
  })

  it('skips rows that already carry ciphertext (idempotent)', () => {
    expect(classifyBackfillRow({ id: 'a', idNumber: SAMPLE_ID, idNumberCiphertext: 'v1:x:y:z' })).toBe('already_encrypted')
    expect(classifyBackfillRow({ id: 'a', idNumber: null, idNumberCiphertext: 'v1:x:y:z' })).toBe('already_encrypted')
  })

  it('skips rows without plaintext', () => {
    expect(classifyBackfillRow({ id: 'a', idNumber: null, idNumberCiphertext: null })).toBe('no_plaintext')
    expect(classifyBackfillRow({ id: 'a', idNumber: '  ', idNumberCiphertext: null })).toBe('no_plaintext')
  })

  it('planBackfill aggregates counts and ids', () => {
    const rows: BackfillRow[] = [
      { id: 'r1', idNumber: SAMPLE_ID, idNumberCiphertext: null },
      { id: 'r2', idNumber: SAMPLE_ID, idNumberCiphertext: 'v1:x:y:z' },
      { id: 'r3', idNumber: null, idNumberCiphertext: null },
      { id: 'r4', idNumber: '9001015800081', idNumberCiphertext: null },
    ]
    const plan = planBackfill(rows)
    expect(plan.needsEncryption).toEqual(['r1', 'r4'])
    expect(plan.alreadyEncrypted).toBe(1)
    expect(plan.noPlaintext).toBe(1)
  })
})

describe('encryptAndVerify', () => {
  it('returns writable columns after a successful round trip', () => {
    const result = encryptAndVerify(SAMPLE_ID)
    expect(result).not.toBeNull()
    expect(decryptIdNumber(result!.idNumberCiphertext)).toBe(SAMPLE_ID)
    expect(result!.idNumberLast4).toBe('9087')
  })

  it('returns null (nothing writable) when the round trip mismatches', () => {
    const badDecrypt = () => 'different-value'
    expect(encryptAndVerify(SAMPLE_ID, encryptIdNumber, badDecrypt)).toBeNull()
  })

  it('returns null when decryption throws', () => {
    const throwingDecrypt = () => {
      throw new Error('boom')
    }
    expect(encryptAndVerify(SAMPLE_ID, encryptIdNumber, throwingDecrypt)).toBeNull()
  })
})

// ─── Retirement verification ─────────────────────────────────────────────────

describe('retirement classification', () => {
  it('retires only rows whose ciphertext round-trips to the exact plaintext', () => {
    const row: RetireRow = { id: 'a', idNumber: SAMPLE_ID, idNumberCiphertext: encryptIdNumber(SAMPLE_ID) }
    expect(classifyRetireRow(row)).toBe('retire')
  })

  it('treats rows without plaintext as already retired', () => {
    expect(classifyRetireRow({ id: 'a', idNumber: null, idNumberCiphertext: 'v1:x:y:z' })).toBe('already_retired')
    expect(classifyRetireRow({ id: 'a', idNumber: '', idNumberCiphertext: null })).toBe('already_retired')
  })

  it('fails rows with plaintext but no ciphertext', () => {
    expect(classifyRetireRow({ id: 'a', idNumber: SAMPLE_ID, idNumberCiphertext: null })).toBe('fail_no_ciphertext')
  })

  it('fails rows whose ciphertext decrypts to a different value', () => {
    const row: RetireRow = { id: 'a', idNumber: SAMPLE_ID, idNumberCiphertext: encryptIdNumber('9999999999999') }
    expect(classifyRetireRow(row)).toBe('fail_verification')
  })

  it('fails rows whose ciphertext cannot be decrypted (tamper/format)', () => {
    const row: RetireRow = { id: 'a', idNumber: SAMPLE_ID, idNumberCiphertext: 'v1:broken:broken:broken' }
    expect(classifyRetireRow(row)).toBe('fail_verification')
  })

  it('canExecuteRetirement refuses when ANY row fails verification', () => {
    const good: RetireRow = { id: 'g', idNumber: SAMPLE_ID, idNumberCiphertext: encryptIdNumber(SAMPLE_ID) }
    const bad: RetireRow = { id: 'b', idNumber: SAMPLE_ID, idNumberCiphertext: null }

    const cleanPlan = planRetirement([good])
    expect(canExecuteRetirement(cleanPlan)).toBe(true)
    expect(cleanPlan.retire).toEqual(['g'])

    const dirtyPlan = planRetirement([good, bad])
    expect(canExecuteRetirement(dirtyPlan)).toBe(false)
    expect(dirtyPlan.failNoCiphertext).toEqual(['b'])
  })
})
