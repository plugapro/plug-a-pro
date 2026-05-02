// Auth / session helper.
//
// This is a STUB. When you lift into the real repo, replace getSession()
// with your actual session reader (NextAuth, Clerk, Supabase Auth, etc.).
//
// What the rest of the scaffold needs from this module:
//   - getSession()     → returns the caller's AdminUser (with roles) or null
//   - requireSession() → throws if no session
//   - requireRole(roles[]) → throws if session lacks any of the allowed roles

import { Role, type AdminUser } from '@prisma/client';
import { db } from './db';
import { cookies } from 'next/headers';

export type AdminSession = {
  user: Pick<AdminUser, 'id' | 'email' | 'name' | 'roles' | 'isActive'>;
};

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'UnauthenticatedError';
  }
}

export class UnauthorizedError extends Error {
  constructor(public readonly needed: Role[], public readonly have: Role[]) {
    super(`Missing required role. Need one of: ${needed.join(', ')}. Have: ${have.join(', ') || '(none)'}.`);
    this.name = 'UnauthorizedError';
  }
}

/**
 * STUB: replace with your real session reader.
 *
 * The example below reads a cookie named 'plugapro_admin_session' containing
 * an email, then looks up the AdminUser. Your real implementation should
 * verify a signed session token (JWT, server-side session, etc).
 */
export async function getSession(): Promise<AdminSession | null> {
  const cookieStore = cookies();
  const email = cookieStore.get('plugapro_admin_session')?.value;
  if (!email) return null;

  const user = await db.adminUser.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, roles: true, isActive: true },
  });

  if (!user || !user.isActive) return null;
  return { user };
}

export async function requireSession(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export async function requireRole(allowed: Role[]): Promise<AdminSession> {
  const session = await requireSession();
  const hasOne = session.user.roles.some((r) => allowed.includes(r));
  if (!hasOne) {
    throw new UnauthorizedError(allowed, session.user.roles);
  }
  return session;
}

/**
 * Check-only (no throw) variant for UI rendering decisions.
 */
export async function hasRole(allowed: Role[]): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  return session.user.roles.some((r) => allowed.includes(r));
}
