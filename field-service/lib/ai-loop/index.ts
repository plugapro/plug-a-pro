/**
 * Plug-A-Pro AI operating loop — public surface.
 *
 * The safe, AI-native operating loop built on OpenBrain. See
 * docs/ai-operating-loop.md for the full design. Import from '@/lib/ai-loop'.
 *
 *   sensor   -> build an OperationalEvent (taxonomy.ts / events.ts)
 *   policy   -> validate + redact + reject unsafe (events.ts / redaction.ts)
 *   tool     -> writeOperationalEvent / safeCapture (openbrain-writer.ts)
 *   gate     -> human-review-policy.ts
 *   learning -> generateImprovementCandidates (improvement-candidates.ts)
 */

export * from './taxonomy'
export * from './redaction'
export * from './events'
export * from './types'
export * from './sink'
export * from './openbrain-writer'
export * from './human-review-policy'
export * from './improvement-candidates'
export * from './admin-view'
