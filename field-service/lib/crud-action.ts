import type { z } from 'zod'
import type { Role } from '@prisma/client'
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
      | 'CONFLICT',
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

function meetsRoleRequirement(actorRole: Role, required: Role[]): boolean {
  const level = ROLE_HIERARCHY[actorRole]
  return required.some((r) => level >= ROLE_HIERARCHY[r])
}

/** Maps legacy user_metadata roles to the AdminUser Role enum. */
function legacyToAdminRole(role: string): Role | null {
  if (role === 'owner') return 'OWNER'
  if (role === 'admin') return 'ADMIN'
  return null
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
  /** Entity ID being acted on. For creates, omit — will be inferred from result. */
  entityId?: string
  /** Audit action string, e.g. 'customer.block', 'location.create'. */
  action: string
  /** Minimum roles allowed. The actor must satisfy at least one. */
  requiredRole: Role[]
  /** Feature flag key that must be enabled before the action runs. */
  requiredFlag?: string
  /** Zod schema to validate raw input. Required when input is provided. */
  schema?: z.ZodType<TInput>
  /** Raw (unvalidated) input data. */
  input?: unknown
  /** Snapshot of the record before mutation — written to AdminAuditEvent.before. */
  before?: Record<string, unknown> | null
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
 *     committed atomically — no partial writes.
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
  // Prefer AdminUser row; fall back to user_metadata role for pre-backfill admins.
  const adminUser = await db.adminUser
    .findUnique({
      where: { userId: session.id },
      select: { id: true, role: true, active: true },
    })
    .catch(() => null)

  const actorRole: Role | null =
    adminUser?.active ? adminUser.role : legacyToAdminRole(session.role)

  if (!actorRole || !meetsRoleRequirement(actorRole, opts.requiredRole)) {
    throw new CrudActionError(
      'UNAUTHORIZED',
      `Requires one of [${opts.requiredRole.join(', ')}]. Actor has: ${actorRole ?? 'none'}.`
    )
  }

  // ── 3. Feature flag ───────────────────────────────────────────────────────────
  if (opts.requiredFlag) {
    const { isEnabled } = await import('./flags')
    const on = await isEnabled(opts.requiredFlag, session.id)
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
  const actorIdForAudit = adminUser?.id ?? session.id

  const data = await db.$transaction(async (tx) => {
    const result = await opts.run(validInput, tx)

    const entityId =
      opts.entityId ?? (result as Record<string, unknown>)?.id?.toString() ?? 'unknown'

    // Always write to the general AuditLog (existing system)
    await tx.auditLog.create({
      data: {
        actorId: session.id,
        actorRole: actorRole,
        action: opts.action,
        entityType: opts.entity,
        entityId,
        before: opts.before ?? undefined,
        after: result as Record<string, unknown>,
      },
    })

    // Also write AdminAuditEvent when the actor has an AdminUser row
    if (adminUser?.id) {
      await tx.adminAuditEvent.create({
        data: {
          adminId: adminUser.id,
          action: opts.action,
          entityType: opts.entity,
          entityId,
          before: opts.before ?? undefined,
          after: result as Record<string, unknown>,
        },
      })
    }

    return result
  })

  return { ok: true, data }
}
