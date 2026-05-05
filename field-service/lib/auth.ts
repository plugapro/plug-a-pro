import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { cache } from 'react'
import type { Role } from '@prisma/client'
import { checkWorkerPortalAccess } from './worker-provider-auth'

// ─── Role definitions ─────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'provider' | 'admin' | 'owner'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  role: UserRole
  providerId?: string // set when role === 'provider'
}

export interface AdminAuthUser extends AuthUser {
  adminRole: Role
  adminUserId: string | null
}

// ─── Supabase client (server-side, per-request) ───────────────────────────────

function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
    },
  })
}

export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase service role credentials')
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

// ─── Session resolution ───────────────────────────────────────────────────────
// Cached per-request — safe to call multiple times in a Server Component tree

export const getSession = cache(async (): Promise<AuthUser | null> => {
  try {
    const cookieStore = await cookies()
    // Read the token set by POST /api/auth/session (HttpOnly cookie)
    const token = cookieStore.get('sb-access-token')?.value
    if (!token) return null

    const supabase = createServerClient()

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) return null

    // Supabase stores phone without the '+' prefix (e.g. "27821234567").
    // Normalise to E.164 so comparisons downstream are consistent.
    const rawPhone = user.phone ?? null
    const phone = rawPhone
      ? rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`
      : null

    // Role and providerId are stored in user_metadata for new users, but older
    // OTP identities may only be linked in the Provider table after first login.
    let role = (user.user_metadata?.role ?? 'customer') as UserRole
    let providerId = user.user_metadata?.providerId as string | undefined

    const { db } = await import('./db')
    const provider = await db.provider.findFirst({
      where: {
        OR: [
          { userId: user.id },
          ...(phone ? [{ phone, userId: null }] : []),
        ],
      },
      select: {
        id: true,
        userId: true,
        phone: true,
        active: true,
        verified: true,
        status: true,
      },
    }).catch(() => null)

    if (checkWorkerPortalAccess(provider).ok) {
      role = 'provider'
      providerId = provider?.id
    }

    return {
      id: user.id,
      email: user.email ?? null,
      phone,
      role,
      providerId,
    }
  } catch {
    return null
  }
})

const ROLE_HIERARCHY: Record<Role, number> = {
  OPS: 1,
  FINANCE: 2,
  TRUST: 3,
  ADMIN: 4,
  OWNER: 5,
}

function meetsRoleRequirement(actorRole: Role, required: Role[]): boolean {
  const level = ROLE_HIERARCHY[actorRole]
  return required.some((role) => level >= ROLE_HIERARCHY[role])
}

const getAdminActor = cache(async (): Promise<AdminAuthUser | null> => {
  const session = await getSession()
  if (!session) return null

  const { db } = await import('./db')
  const adminUser = await db.adminUser.findFirst({
    where: { OR: [{ userId: session.id }, { email: session.email ?? '' }] },
    select: { id: true, role: true, active: true },
  })

  if (adminUser?.active) {
    return {
      ...session,
      adminRole: adminUser.role,
      adminUserId: adminUser.id,
    }
  }

  // Legacy fallback: honour Supabase user_metadata.role for accounts predating
  // the AdminUser table. Run backfill-admin-users.ts to migrate permanently.
  const metaRole = session.role
  if (metaRole === 'admin' || metaRole === 'owner') {
    return {
      ...session,
      adminRole: (metaRole.toUpperCase() as Role),
      adminUserId: null,
    }
  }

  return null
})

// ─── Route guards ─────────────────────────────────────────────────────────────

/** Call in admin route layouts — redirects when the caller has no active admin access. */
export async function requireAdmin(): Promise<AdminAuthUser> {
  const actor = await getAdminActor()
  if (actor) return actor

  const session = await getSession()
  if (!session) redirect('/admin-sign-in')
  redirect('/admin-sign-in?error=unauthorized')
}

/** Call in API route handlers — returns 401 JSON if the caller has no active admin access. */
export async function requireAdminApi(): Promise<NextResponse | null> {
  const actor = await getAdminActor()
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

/**
 * Call in admin pages/actions that require a specific DB-backed AdminUser role.
 */
export async function requireRole(required: Role[]): Promise<AdminAuthUser> {
  const actor = await requireAdmin()
  if (!meetsRoleRequirement(actor.adminRole, required)) {
    forbidden()
  }
  return actor
}

/** Call in provider route layouts — redirects to /provider-sign-in if not provider */
export async function requireProvider(): Promise<AuthUser> {
  const session = await getSession()
  if (!session) redirect('/provider-sign-in')
  if (session.role !== 'provider') {
    redirect('/provider-sign-in?error=unauthorized')
  }
  const { db } = await import('./db')
  const provider = await db.provider.findFirst({
    where: {
      OR: [
        { userId: session.id },
        ...(session.providerId ? [{ id: session.providerId }] : []),
      ],
    },
    select: {
      id: true,
      userId: true,
      phone: true,
      active: true,
      verified: true,
      status: true,
    },
  }).catch(() => null)

  if (!checkWorkerPortalAccess(provider).ok) {
    redirect('/provider-sign-in?error=unauthorized')
  }
  return session
}

/** Call in customer routes — returns null if not authenticated (customer routes allow guests) */
export async function getCustomerSession(): Promise<AuthUser | null> {
  return getSession()
}

// ─── Identity continuity — WhatsApp ↔ PWA bridge ─────────────────────────────
//
// Customers who book via WhatsApp start as phone-only records with userId=null.
// When they later authenticate on the PWA via phone OTP, we call this function
// to link their Supabase Auth user to the existing Customer record.
// After this point both channels resolve to the same row — no duplicate records.

export async function linkCustomerAccount(params: {
  userId: string
  phone: string     // E.164 format, e.g. "+27821234567"
  name?: string     // Optionally update name if it's still the WhatsApp placeholder
}): Promise<{ id: string; isNew: boolean }> {
  const { db } = await import('./db')
  const { createTestCohortContext } = await import('./internal-test-cohort')
  const cohort = createTestCohortContext(params.phone)

  // Check if this userId is already linked (idempotent)
  const alreadyLinked = await db.customer.findUnique({
    where: { userId: params.userId },
    select: { id: true },
  })
  if (alreadyLinked) return { id: alreadyLinked.id, isNew: false }

  // Find existing WhatsApp-created customer by phone
  const existing = await db.customer.findUnique({
    where: { phone: params.phone },
  })

  if (existing) {
    // Link: set userId on the existing record
    const updates: { userId: string; name?: string; isTestUser?: boolean; cohortName?: string | null } = {
      userId: params.userId,
      ...(cohort.isTestUser ? { isTestUser: true, cohortName: cohort.cohortName } : {}),
    }
    // Only overwrite name if it's still the default placeholder
    if (params.name && existing.name === 'WhatsApp Customer') {
      updates.name = params.name
    }
    await db.customer.update({
      where: { id: existing.id },
      data: updates,
    })
    return { id: existing.id, isNew: false }
  }

  // No prior WhatsApp record — create fresh customer linked from the start
  const created = await db.customer.create({
    data: {
      userId: params.userId,
      phone: params.phone,
      name: params.name ?? 'Customer',
      isTestUser: cohort.isTestUser,
      cohortName: cohort.cohortName,
    },
  })
  return { id: created.id, isNew: true }
}
