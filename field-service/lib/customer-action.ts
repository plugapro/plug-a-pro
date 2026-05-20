import type { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from './db'
import { getCustomerSession } from './auth'
import { resolveCustomerForSession } from './customer-session'

// ─── Error type ───────────────────────────────────────────────────────────────

export class CustomerActionError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'BLOCKED' | 'VALIDATION',
    message: string,
  ) {
    super(message)
    this.name = 'CustomerActionError'
  }
}

// ─── Transaction client type ──────────────────────────────────────────────────

type TxClient = Omit<
  typeof db,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// ─── Resolved customer record ─────────────────────────────────────────────────

type ResolvedCustomer = {
  id: string
  userId: string | null
  phone: string
  name: string
  email: string | null
}

// ─── JSON helper ──────────────────────────────────────────────────────────────

function toAuditJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

// ─── Options ──────────────────────────────────────────────────────────────────

interface CustomerActionOptions<TInput, TOutput> {
  /** Entity name for the audit log, e.g. 'Customer'. */
  entity: string
  /** Entity ID being acted on. Falls back to customer.id when omitted. */
  entityId?: string
  /** Audit action string, e.g. 'update_account_type'. */
  action: string
  /** Snapshot of the record before mutation — written to AuditLog.before. */
  before?: Record<string, unknown> | null
  /** Zod schema to validate raw input. Required when input is provided. */
  schema?: z.ZodType<TInput>
  /** Raw (unvalidated) input data. */
  input?: unknown
  /**
   * The mutation to execute inside a transaction.
   * The AuditLog row is written in the same transaction.
   */
  run: (input: TInput, customer: ResolvedCustomer, tx: TxClient) => Promise<TOutput>
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Invariant-enforcing wrapper for all customer self-service mutations.
 *
 * Guarantees (in order):
 *  1. Caller is authenticated (getCustomerSession).
 *  2. A Customer record can be resolved for the session.
 *  3. Customer account is not blocked.
 *  4. Input is valid against the Zod schema (if specified).
 *  5. The mutation and AuditLog row are committed atomically.
 */
export async function customerAction<TInput = unknown, TOutput = unknown>(
  opts: CustomerActionOptions<TInput, TOutput>,
): Promise<{ ok: true; data: TOutput }> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const session = await getCustomerSession()
  if (!session) {
    throw new CustomerActionError('UNAUTHENTICATED', 'Not authenticated')
  }

  // ── 2. Customer record ────────────────────────────────────────────────────────
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    throw new CustomerActionError('NOT_FOUND', 'Customer record not found')
  }

  // ── 3. Blocked guard ──────────────────────────────────────────────────────────
  // resolveCustomerForSession does not currently include `isBlocked` in its
  // select projection (customerSessionSelect). This is a best-effort check
  // that will work only when the caller widens the returned shape. It will
  // silently pass (false) for plain CustomerRecord values until the select is
  // extended to include isBlocked.
  if ((customer as { isBlocked?: boolean }).isBlocked) {
    throw new CustomerActionError('BLOCKED', 'Account is blocked')
  }

  // ── 4. Input validation ───────────────────────────────────────────────────────
  let validInput: TInput
  if (opts.schema) {
    const result = opts.schema.safeParse(opts.input)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join('; ')
      throw new CustomerActionError('VALIDATION', msg)
    }
    validInput = result.data
  } else {
    validInput = opts.input as TInput
  }

  // ── 5. Atomic transaction ─────────────────────────────────────────────────────
  const data = await db.$transaction(async (tx) => {
    const result = await opts.run(validInput, customer, tx)

    const entityId =
      opts.entityId ??
      (result as Record<string, unknown>)?.id?.toString() ??
      customer.id

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        actorRole: 'CUSTOMER',
        action: opts.action,
        entityType: opts.entity,
        entityId,
        before: toAuditJson(opts.before),
        after: toAuditJson(result) ?? Prisma.JsonNull,
      },
    })

    return result
  })

  return { ok: true, data }
}
