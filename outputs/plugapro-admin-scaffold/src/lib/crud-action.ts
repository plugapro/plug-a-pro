// The crudAction() helper.
//
// This is THE pattern for every admin mutation. It guarantees:
//   - Authenticated caller
//   - Authorized caller (role check)
//   - Feature flag check (if specified)
//   - Zod-validated input
//   - Audit event written on success
//   - Typed result (discriminated union)
//
// Usage:
//
//   export const updateCustomer = crudAction({
//     name: 'customer.update',
//     entity: 'Customer',
//     schema: z.object({ id: z.string(), name: z.string().min(1) }),
//     requiredRole: [Role.OPS, Role.ADMIN, Role.OWNER],
//     requiredFlag: 'admin.crud.customers',
//     revalidate: (input) => [`/admin/customers`, `/admin/customers/${input.id}`],
//     auditPayload: (input, out) => ({ before: out.before, after: out.after, reason: input.reason }),
//     run: async (input, ctx) => {
//       const before = await ctx.db.customer.findUniqueOrThrow({ where: { id: input.id } });
//       const after = await ctx.db.customer.update({ where: { id: input.id }, data: input });
//       return { entityId: input.id, before, after };
//     },
//   });
//
// Call from a client component via server action import.

'use server';

import { z, ZodSchema } from 'zod';
import { Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { db } from './db';
import {
  requireSession,
  requireRole,
  UnauthenticatedError,
  UnauthorizedError,
  type AdminSession,
} from './auth';
import { isEnabled, FlagDisabledError, type FlagKey } from './flags';
import { writeAudit } from './audit';

export type CrudActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'FLAG_DISABLED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL'; message: string; details?: unknown };

export interface CrudRunContext {
  db: typeof db;
  session: AdminSession;
}

export interface CrudRunResult {
  /** Required — the entity that was mutated. Used in the audit row. */
  entityId: string;
  /** Optional — shown to the caller as result.data. */
  [key: string]: unknown;
}

export interface CrudActionDefinition<Input, Output extends CrudRunResult> {
  /** Dotted name. Used for audit (`action` column) and error messages. */
  name: string;
  /** Entity type written to audit. Typically the Prisma model name. */
  entity: string;
  /** Input validation schema. */
  schema: ZodSchema<Input>;
  /** Who can call this. Usually `[Role.OPS, Role.ADMIN, Role.OWNER]` or tighter. */
  requiredRole: Role[];
  /** Optional feature flag gate. If set, the flag must be enabled for the caller. */
  requiredFlag?: FlagKey;
  /** Optional list of paths to revalidate after success. */
  revalidate?: string[] | ((input: Input, out: Output) => string[]);
  /** Optional custom audit payload builder. Defaults to `{ input, output }`. */
  auditPayload?: (input: Input, out: Output) => Record<string, unknown>;
  /** The actual business logic. */
  run: (input: Input, ctx: CrudRunContext) => Promise<Output>;
}

export function crudAction<Input, Output extends CrudRunResult>(
  def: CrudActionDefinition<Input, Output>,
) {
  return async function action(rawInput: unknown): Promise<CrudActionResult<Output>> {
    // ---- 1. Auth -----------------------------------------------------
    let session: AdminSession;
    try {
      session = await requireSession();
    } catch (e) {
      if (e instanceof UnauthenticatedError) {
        return { ok: false, code: 'UNAUTHENTICATED', message: 'Not signed in.' };
      }
      throw e;
    }

    // ---- 2. Role -----------------------------------------------------
    try {
      await requireRole(def.requiredRole);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        return {
          ok: false,
          code: 'UNAUTHORIZED',
          message: `${def.name}: missing role. Needed one of ${e.needed.join(', ')}.`,
        };
      }
      throw e;
    }

    // ---- 3. Flag -----------------------------------------------------
    if (def.requiredFlag) {
      const enabled = await isEnabled(def.requiredFlag, { userId: session.user.id });
      if (!enabled) {
        return {
          ok: false,
          code: 'FLAG_DISABLED',
          message: `${def.name}: feature flag ${def.requiredFlag} is disabled.`,
        };
      }
    }

    // ---- 4. Validate ------------------------------------------------
    const parsed = def.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'Input failed validation.',
        details: parsed.error.flatten(),
      };
    }
    const input = parsed.data as Input;

    // ---- 5. Run + audit (one transaction) ---------------------------
    try {
      const output = await db.$transaction(async (tx) => {
        const ctx: CrudRunContext = { db: tx as unknown as typeof db, session };
        const result = await def.run(input, ctx);

        const payload = def.auditPayload ? def.auditPayload(input, result) : { input, output: result };
        await writeAudit(
          {
            entityType: def.entity,
            entityId: result.entityId,
            action: def.name,
            actorUserId: session.user.id,
            payload,
          },
          tx,
        );

        return result;
      });

      // ---- 6. Revalidate -------------------------------------------
      if (def.revalidate) {
        const paths = typeof def.revalidate === 'function' ? def.revalidate(input, output) : def.revalidate;
        for (const p of paths) revalidatePath(p);
      }

      return { ok: true, data: output };
    } catch (e: unknown) {
      return handleRunError(def.name, e);
    }
  };
}

function handleRunError(actionName: string, e: unknown): CrudActionResult<never> {
  // Minimal unwrapping of common Prisma errors. Extend as needed.
  // Prisma "record not found" -> NOT_FOUND, unique constraint -> CONFLICT.
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: string }).code;
    if (code === 'P2025') {
      return { ok: false, code: 'NOT_FOUND', message: `${actionName}: record not found.` };
    }
    if (code === 'P2002') {
      return { ok: false, code: 'CONFLICT', message: `${actionName}: unique constraint violation.` };
    }
  }
  console.error(`[crudAction:${actionName}]`, e);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'An unexpected error occurred.',
  };
}
