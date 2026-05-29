import type { NormalizedVerificationDecision } from '../types'

// Smile ID Enhanced Document Verification (job_type=11) result codes.
// Source: docs.usesmileid.com/further-reading/result-codes
// Verified against sandbox in 2026-05-27 probe; see
// docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md.

export const SMILE_ID_EVD_PASS_RESULT_CODES: ReadonlySet<string> = new Set([
  '0810',  // Document Verified - approved
])

export const SMILE_ID_EVD_FAIL_RESULT_CODES: ReadonlySet<string> = new Set([
  '0811',  // Unable to verify document (selfie/photo mismatch, liveness fail, missing security)
  '0812',  // Unable to verify document (not classified / invalid document image)
  '0816',  // Unable to verify document - unsupported document
  '1014',  // Unsupported ID number format (also fires on sandbox data hitting prod)
])

export const SMILE_ID_EVD_TERMINAL_RESULT_CODES: ReadonlySet<string> = new Set([
  ...SMILE_ID_EVD_PASS_RESULT_CODES,
  ...SMILE_ID_EVD_FAIL_RESULT_CODES,
])

export function isTerminalResultCode(code: string | null | undefined): boolean {
  if (!code) return false
  return SMILE_ID_EVD_TERMINAL_RESULT_CODES.has(code)
}

export function deriveDecision(code: string | null | undefined): NormalizedVerificationDecision {
  if (!code) return 'INCONCLUSIVE'
  if (SMILE_ID_EVD_PASS_RESULT_CODES.has(code)) return 'PASS'
  if (SMILE_ID_EVD_FAIL_RESULT_CODES.has(code)) return 'FAIL'
  return 'INCONCLUSIVE'
}
