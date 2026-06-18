import type { z } from 'zod'
import { Prisma, type Role } from '@prisma/client'
import { db } from './db'
import { getSession } from './auth'

// ─── Error type ───────────────────────────────────────────────────────────────

export class CrudActionError extends Error {
  constructor(
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'UNAUTHORIZED'
      | 'FLAG_DISABLED'
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'CONFLICT'
      // FORBIDDEN — used when the actor is authenticated and has the role,
      // but the action is denied by a domain policy (e.g. the KYC approval
      // gate refuses to flip verified=true on a non-VERIFIED provider).
      // Distinct from UNAUTHORIZED so callers can surface a different
      // message ("you don't have permission" vs. "this provider isn't
      // eligible for this action").
      | 'FORBIDDEN',
    message: string
  ) {
    super(message)
    this.name = 'CrudActionError'
  }
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<Role, number> = {
  OPS: 1,
  FINANCE: 2,
  TRUST: 3,
  ADMIN: 4,
  OWNER: 5,
}

export function meetsRoleRequirement(
  actorRole: Role,
  required: Role[],
  excluded: Role[] = [],
): boolean {
  if (excluded.includes(actorRole)) return false
  const level = ROLE_HIERARCHY[actorRole]
  return required.some((r) => level >= ROLE_HIERARCHY[r])
}

/**
 * Exact-match role check (no hierarchy). The actor's role must be one of
 * `required`. OWNER is always allowed as a break-glass super-admin. Use when a
 * higher-tier role must NOT inherit a lower-tier permission via the hierarchy
 * (e.g. FINANCE inheriting OPS-level provider trust mutations).
 */
export function meetsExactRoleRequirement(
  actorRole: Role,
  required: Role[],
  excluded: Role[] = [],
): boolean {
  if (excluded.includes(actorRole)) return false
  if (actorRole === 'OWNER') return true
  return new Set(required).has(actorRole)
}

function toAuditJson(
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

// ─── Transaction client type ──────────────────────────────────────────────────

type TxClient = Omit<
  typeof db,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// ─── Options ──────────────────────────────────────────────────────────────────

interface CrudActionOptions<TInput, TOutput> {
  /** Entity name for the audit log, e.g. 'Customer', 'Location'. */
  entity: string
  /** Entity ID being acted on. For creates, omit - will be inferred from result. */
  entityId?: string
  /** Audit action string, e.g. 'customer.block', 'location.create'. */
  action: string
  /** Minimum roles allowed. The actor must satisfy at least one. */
  requiredRole: Role[]
  /** Roles explicitly denied even when they satisfy the hierarchy floor. */
  excludedRole?: Role[]
  /**
   * When true, the actor's role must be EXACTLY one of `requiredRole`
   * (Set membership), bypassing the role hierarchy entirely. Use for
   * scoped responsibilities where a higher-tier role (e.g. FINANCE) must
   * NOT inherit a lower-tier permission (e.g. OPS) just because it sits
   * above it in the hierarchy. OWNER is always permitted as a break-glass
   * super-admin even under exact matching.
   */
  roleExact?: boolean
  /** Feature flag key that must be enabled before the action runs. */
  requiredFlag?: string
  /** Zod schema to validate raw input. Required when input is provided. */
  schema?: z.ZodType<TInput>
  /** Raw (unvalidated) input data. */
  input?: unknown
  /** Snapshot of the record before mutation - written to AdminAuditEvent.before. */
  before?: Record<string, unknown> | null
  /**
   * Optional human-readable justification for this action.
   * Written into both audit rows so reviewers can reconstruct why the
   * change was made, not only what changed.
   */
  reason?: string
  /**
   * The mutation to execute inside a transaction.
   * The AuditLog / AdminAuditEvent rows are written in the same transaction.
   */
  run: (input: TInput, tx: TxClient) => Promise<TOutput>
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Invariant-enforcing wrapper for all admin mutations.
 *
 * Guarantees (in order):
 *  1. Actor is authenticated.
 *  2. Actor meets the required role.
 *  3. Required feature flag is enabled (if specified).
 *  4. Input is valid against the Zod schema (if specified).
 *  5. The mutation and both audit rows (AuditLog + AdminAuditEvent) are
 *     committed atomically - no partial writes.
 */
export async function crudAction<TInput = unknown, TOutput = unknown>(
  opts: CrudActionOptions<TInput, TOutput>
): Promise<{ ok: true; data: TOutput }> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const session = await getSession()
  if (!session) {
    throw new CrudActionError('UNAUTHENTICATED', 'Authentication required.')
  }

  // ── 2. Role ──────────────────────────────────────────────────────────────────
  const adminUser = await db.adminUser
    .findUnique({
      where: { userId: session.id },
      select: { id: true, role: true, active: true },
    })
    .catch(() => null)

  const roleSatisfied =
    adminUser?.active === true &&
    (opts.roleExact
      ? meetsExactRoleRequirement(adminUser.role, opts.requiredRole, opts.excludedRole)
      : meetsRoleRequirement(adminUser.role, opts.requiredRole, opts.excludedRole))

  if (!adminUser || !roleSatisfied) {
    throw new CrudActionError(
      'UNAUTHORIZED',
      `Requires ${opts.roleExact ? 'exactly' : 'one of'} [${opts.requiredRole.join(', ')}]. Actor has: ${adminUser?.role ?? 'none'}.`
    )
  }

  // ── 3. Feature flag ───────────────────────────────────────────────────────────
  if (opts.requiredFlag) {
    const { isEnabled } = await import('./flags')
    // requiredFlag is declared as a free-form `string` for caller ergonomics,
    // but isEnabled wants the strict FlagKey union. Callers either pass a
    // literal that satisfies FlagKey or accept the runtime check that
    // isEnabled performs against the DB / env. Cast through `as any` since
    // FlagKey isn't re-exported here without widening the public surface.
    const on = await isEnabled(opts.requiredFlag as Parameters<typeof isEnabled>[0], { userId: session.id })
    if (!on) {
      throw new CrudActionError(
        'FLAG_DISABLED',
        `Feature '${opts.requiredFlag}' is not enabled.`
      )
    }
  }

  // ── 4. Input validation ───────────────────────────────────────────────────────
  let validInput: TInput
  if (opts.schema) {
    const result = opts.schema.safeParse(opts.input)
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join('; ')
      throw new CrudActionError('VALIDATION', msg)
    }
    validInput = result.data
  } else {
    validInput = opts.input as TInput
  }

  // ── 5. Atomic transaction ─────────────────────────────────────────────────────
  const data = await db.$transaction(async (tx) => {
    const result = await opts.run(validInput, tx)

    const entityId =
      opts.entityId ?? (result as Record<string, unknown>)?.id?.toString() ?? 'unknown'

    // Always write to the general AuditLog (existing system)
    await tx.auditLog.create({
      data: {
        actorId: session.id,
        actorRole: adminUser.role,
        action: opts.action,
        entityType: opts.entity,
        entityId,
        before: toAuditJson(opts.before),
        after: toAuditJson(result),
        reason: opts.reason,
      },
    })

    await tx.adminAuditEvent.create({
      data: {
        adminId: adminUser.id,
        action: opts.action,
        entityType: opts.entity,
        entityId,
        before: toAuditJson(opts.before),
        after: toAuditJson(result),
        metadata: (opts.reason ? { reason: opts.reason } : {}) as Prisma.InputJsonValue,
      },
    })

    return result
  })

  return { ok: true, data }
}
