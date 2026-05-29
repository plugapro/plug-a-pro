import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { applyVendorVerdict } from '@/lib/identity-verification/orchestrator'
import { getAdapter, toVendorKey } from '@/lib/identity-verification/vendors/registry'
import type { ParseWebhookResult } from '@/lib/identity-verification/vendors/types'
import { raiseSecurityReviewEvent } from '@/lib/security/security-event-service'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  context: { params: Promise<{ vendor: string }> },
) {
  const { vendor } = await context.params
  const vendorKey = toVendorKey(vendor)
  if (!vendorKey) return NextResponse.json({ ok: false }, { status: 404 })

  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const adapter = getAdapter(vendorKey)
  const parsed = await adapter.parseWebhook({ headers, rawBody })

  // Signature gate FIRST — refuse to persist audit rows for unauthenticated
  // payloads. Previously any internet scanner POSTing garbage could pollute
  // ProviderVerificationWebhookEvent with rows carrying real-looking vendor
  // references from the forged body.
  if (!parsed.signatureValid) {
    return NextResponse.json({ ok: false, code: 'INVALID_SIGNATURE' }, { status: 401 })
  }

  const idempotencyKey = computeIdempotencyKey(vendorKey, parsed)

  let row: { id: string; signatureValid?: boolean; processedAt?: Date | null }
  try {
    row = await db.providerVerificationWebhookEvent.create({
      data: {
        vendorKey,
        vendorEventId: parsed.vendorEventId,
        idempotencyKey,
        vendorReference: parsed.vendorReference,
        livenessSessionReference: parsed.livenessSessionReference,
        eventType: parsed.eventType,
        signatureValid: parsed.signatureValid,
        payloadHash: parsed.payloadHash,
        rawPayloadRedacted: parsed.redactedPayload as Prisma.InputJsonValue | undefined,
      },
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const existing = await db.providerVerificationWebhookEvent.findUnique({
      where: { idempotencyKey },
      select: { id: true, signatureValid: true, processedAt: true },
    })
    if (!existing) throw error
    // Defensive no-op: with the signature gate above we never write a row with
    // signatureValid:false anymore, but keep the branch in case a legacy row
    // exists from before this fix or a future caller bypasses the gate.
    if (existing.signatureValid === false) return NextResponse.json({ ok: false }, { status: 401 })
    if (existing.processedAt) return NextResponse.json({ ok: true })
    row = existing
  }

  const candidates = await findVerificationCandidates(vendorKey, parsed)
  const distinctIds = [...new Set(candidates.map((candidate) => candidate.id))]
  if (distinctIds.length === 0) {
    await db.providerVerificationWebhookEvent.update({
      where: { id: row.id },
      data: { processedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  }

  if (distinctIds.length > 1) {
    await db.providerVerificationWebhookEvent.update({
      where: { id: row.id },
      data: {
        processingError: 'AMBIGUOUS_REFERENCE_RESOLUTION',
        processedAt: new Date(),
      },
    })
    await raiseSecurityReviewEvent({
      eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      severity: 'HIGH',
      sourceChannel: 'SYSTEM',
      subjectWebhookEventId: row.id,
      metadata: {
        webhookEventId: row.id,
        vendorKey,
        vendorReference: parsed.vendorReference,
        livenessSessionReference: parsed.livenessSessionReference,
        verificationId: parsed.verificationId,
        matchedVerificationIds: distinctIds,
        reasonCode: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      },
    })
    return NextResponse.json({ ok: true })
  }

  const verification = await db.providerIdentityVerification.findUniqueOrThrow({
    where: { id: distinctIds[0] },
    select: { id: true },
  })

  if (parsed.result) {
    try {
      await applyVendorVerdict(verification.id, parsed.result, 'webhook')
    } catch (error) {
      await db.providerVerificationWebhookEvent.update({
        where: { id: row.id },
        data: {
          processingError: error instanceof Error ? error.message : String(error),
        },
      })
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  }

  await db.providerVerificationWebhookEvent.update({
    where: { id: row.id },
    data: {
      verificationId: verification.id,
      processedAt: new Date(),
    },
  })
  return NextResponse.json({ ok: true })
}

function computeIdempotencyKey(vendorKey: string, parsed: ParseWebhookResult) {
  if (parsed.vendorEventId) return `${vendorKey}:${parsed.vendorEventId}`
  return `${vendorKey}:${parsed.vendorReference ?? '_'}:${parsed.eventType ?? '_'}:${parsed.payloadHash}`
}

async function findVerificationCandidates(vendorKey: string, parsed: ParseWebhookResult) {
  const orClauses = [
    parsed.verificationId ? { id: parsed.verificationId } : null,
    parsed.vendorReference ? { vendorReference: parsed.vendorReference } : null,
    parsed.livenessSessionReference ? { livenessSessionReference: parsed.livenessSessionReference } : null,
  ].filter((clause): clause is { id: string } | { vendorReference: string } | { livenessSessionReference: string } => Boolean(clause))
  if (orClauses.length === 0) return []

  return db.providerIdentityVerification.findMany({
    where: {
      sourceCheckProvider: vendorKey,
      OR: orClauses,
    },
    select: { id: true },
  })
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002',
  )
}
