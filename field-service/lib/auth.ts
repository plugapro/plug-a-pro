import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

// ─── Role definitions ─────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'provider' | 'admin' | 'owner'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  role: UserRole
  providerId?: string // set when role === 'provider'
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

    // Role and providerId are stored in user_metadata during sign-up/invite
    const role = (user.user_metadata?.role ?? 'customer') as UserRole
    const providerId = user.user_metadata?.providerId

    return {
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      role,
      providerId,
    }
  } catch {
    return null
  }
})

// ─── Route guards ─────────────────────────────────────────────────────────────

/** Call in admin route layouts — redirects to /admin-sign-in if not admin/owner */
export async function requireAdmin(): Promise<AuthUser> {
  const session = await getSession()
  if (!session) redirect('/admin-sign-in')
  if (session.role !== 'admin' && session.role !== 'owner') {
    redirect('/admin-sign-in?error=unauthorized')
  }
  return session
}

/** Call in provider route layouts — redirects to /provider-sign-in if not provider */
export async function requireProvider(): Promise<AuthUser> {
  const session = await getSession()
  if (!session) redirect('/provider-sign-in')
  if (session.role !== 'provider') {
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
    const updates: { userId: string; name?: string } = { userId: params.userId }
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
    },
  })
  return { id: created.id, isNew: true }
}
