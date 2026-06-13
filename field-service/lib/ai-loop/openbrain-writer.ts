/**
 * Plug-A-Pro AI operating loop — the safe OpenBrain event writer.
 *
 * Contract (in order):
 *   1. validate the event against the taxonomy;
 *   2. reject outright if any raw DENY-tier field is present (no silent scrub);
 *   3. redact soft PII and summarise free text;
 *   4. persist via the sink;
 *   5. degrade safely — a sink/validation failure NEVER throws and NEVER blocks
 *      the caller. The function always resolves to a result object.
 *
 * This is the only supported way to get an operational event into OpenBrain.
 * Call it fire-and-forget from request handlers: `void safeCapture(event)`.
 */

import { randomUUID } from 'crypto'
import { getEventDefinition } from './taxonomy'
import { validateEvent, type OperationalEvent } from './events'
import { findRawSensitiveFields, redactMetadata, safeReference } from './redaction'
import { resolveDefaultSink, type AiLoopSink } from './sink'
import type { ObservationRecord } from './types'

export interface WriteEventResult {
  /** false only when the input was malformed or unsafe (still non-throwing). */
  ok: boolean
  /** true if a record reached the sink. */
  written: boolean
  /** true if the event was refused for safety (unsafe field / not eligible). */
  rejected: boolean
  reasons: string[]
  observationId?: string
}

export interface WriteEventOptions {
  sink?: AiLoopSink
  /** Override the recorded timestamp (tests). */
  now?: () => string
}

function logWarn(message: string, context: Record<string, unknown>) {
  // Structured, PII-free warning — mirrors lib/application-error-service.ts style.
  console.warn(`[ai-loop] ${message}`, context)
}

/**
 * Write a single operational event. Never throws.
 */
export async function writeOperationalEvent(
  event: OperationalEvent,
  options: WriteEventOptions = {},
): Promise<WriteEventResult> {
  try {
    const validation = validateEvent(event)
    if (!validation.ok) {
      logWarn('event rejected by validation', {
        event: event?.name ?? '(unknown)',
        reasons: validation.errors,
      })
      return { ok: false, written: false, rejected: true, reasons: validation.errors }
    }

    const def = getEventDefinition(event.name)!
    if (!def.openBrainEligible) {
      return {
        ok: true,
        written: false,
        rejected: true,
        reasons: [`${event.name} is not openBrainEligible`],
      }
    }

    // Belt-and-braces: validateEvent already checks this, but re-check the merged
    // surface so a future code path can't bypass it.
    const sensitive = findRawSensitiveFields({
      metadata: event.metadata,
      entityRefs: event.entityRefs,
      actorRef: event.actorRef,
    })
    if (sensitive.length > 0) {
      logWarn('event rejected — raw sensitive field present', {
        event: event.name,
        fields: sensitive.map((f) => f.path),
      })
      return {
        ok: false,
        written: false,
        rejected: true,
        reasons: sensitive.map((f) => `raw sensitive field: ${f.path}`),
      }
    }

    const now = options.now ?? (() => new Date().toISOString())
    const strict = def.redactionProfile === 'strict'
    const safeEntityRefs: Record<string, string> = {}
    if (def.redactionProfile !== 'aggregate') {
      for (const [key, value] of Object.entries(event.entityRefs ?? {})) {
        const ref = safeReference(value)
        if (ref) safeEntityRefs[key] = ref
      }
    }

    const record: ObservationRecord = {
      id: `obs_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      event: event.name,
      category: event.category ?? def.category,
      severity: event.severity ?? def.defaultSeverity,
      actorType: event.actorType,
      actorRef: safeReference(event.actorRef ?? null),
      entityRefs: safeEntityRefs,
      affectedFlow: event.affectedFlow ?? null,
      occurredAt: event.occurredAt,
      recordedAt: now(),
      metadata: (redactMetadata(event.metadata ?? {}, { strict }) as Record<string, unknown>) ?? {},
      isTestEvent: Boolean(event.isTestEvent),
    }

    const sink = options.sink ?? resolveDefaultSink()
    try {
      await sink.writeObservation(record)
      return { ok: true, written: true, rejected: false, reasons: [], observationId: record.id }
    } catch (sinkErr) {
      // Storage failure is non-fatal: the loop must never block a real flow.
      logWarn('observation sink write failed (non-fatal)', {
        event: event.name,
        error: sinkErr instanceof Error ? sinkErr.message : String(sinkErr),
      })
      return { ok: true, written: false, rejected: false, reasons: ['sink_unavailable'], observationId: record.id }
    }
  } catch (err) {
    // Absolute backstop — the writer must never surface an exception.
    logWarn('writer crashed (suppressed)', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, written: false, rejected: false, reasons: ['writer_error'] }
  }
}

/**
 * Fire-and-forget convenience for hot paths. Swallows everything.
 * Usage: `void safeCapture({ ... })`
 */
export async function safeCapture(
  event: OperationalEvent,
  options: WriteEventOptions = {},
): Promise<void> {
  try {
    await writeOperationalEvent(event, options)
  } catch {
    // writeOperationalEvent already never throws; this is pure paranoia.
  }
}
