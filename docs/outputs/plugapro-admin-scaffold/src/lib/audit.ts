// Audit helper. Writes AdminAuditEvent rows.
//
// Used directly by crudAction(), but also usable from any server action
// that wants to record something (e.g. a webhook handler mapping system
// events onto the audit log).

import { db } from './db';
import type { Prisma } from '@prisma/client';

export interface AuditRecord {
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string;
  payload?: Record<string, unknown>;
}

export async function writeAudit(
  record: AuditRecord,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? db;
  await client.adminAuditEvent.create({
    data: {
      entityType: record.entityType,
      entityId: record.entityId,
      action: record.action,
      actorUserId: record.actorUserId,
      payload: (record.payload ?? {}) as Prisma.JsonObject,
    },
  });
}

/**
 * Convenience: a shallow diff of two Prisma records. Good enough for audit
 * trails where you want to know "what changed." Not cryptographically sound;
 * do not use for security-sensitive diffs.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { changed: Record<string, { before: unknown; after: unknown }> } {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (!shallowEqual(before[k], after[k])) {
      changed[k] = { before: before[k], after: after[k] };
    }
  }
  return { changed };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => shallowEqual(v, b[i]));
  }
  return false;
}
