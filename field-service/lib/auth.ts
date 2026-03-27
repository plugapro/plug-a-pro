import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

// ─── Role definitions ─────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'technician' | 'admin' | 'owner'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  role: UserRole
  businessId: string
  technicianId?: string // set when role === 'technician'
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
    const supabase = createServerClient()

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) return null

    // Role and businessId are stored in user_metadata during sign-up/invite
    const role = (user.user_metadata?.role ?? 'customer') as UserRole
    const businessId = user.user_metadata?.businessId ?? ''
    const technicianId = user.user_metadata?.technicianId

    return {
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      role,
      businessId,
      technicianId,
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

/** Call in technician route layouts — redirects to /technician-sign-in if not technician */
export async function requireTechnician(): Promise<AuthUser> {
  const session = await getSession()
  if (!session) redirect('/technician-sign-in')
  if (session.role !== 'technician') {
    redirect('/technician-sign-in?error=unauthorized')
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
  businessId: string
  name?: string     // Optionally update name if it's still the WhatsApp placeholder
}): Promise<{ id: string; isNew: boolean }> {
  const { db } = await import('./db')

  // Check if this userId is already linked (idempotent)
  const alreadyLinked = await db.customer.findUnique({
    where: { userId: params.userId },
    select: { id: true },
  })
  if (alreadyLinked) return { id: alreadyLinked.id, isNew: false }

  // Find existing WhatsApp-created customer by phone within this business
  const existing = await db.customer.findUnique({
    where: { businessId_phone: { businessId: params.businessId, phone: params.phone } },
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
      businessId: params.businessId,
      userId: params.userId,
      phone: params.phone,
      name: params.name ?? 'Customer',
      active: true,
    },
  })
  return { id: created.id, isNew: true }
}

// ─── Business context ─────────────────────────────────────────────────────────

/**
 * Resolves the current business ID.
 *
 * Single-tenant mode: returns BUSINESS_SLUG from env (after DB lookup)
 * Multi-tenant mode: resolves from subdomain (set in proxy.ts request headers)
 * Authenticated user: returns user.businessId
 */
export async function resolveBusinessId(): Promise<string> {
  const session = await getSession()
  if (session?.businessId) return session.businessId

  // In single-tenant mode, business is identified by env var
  const slug = process.env.BUSINESS_SLUG
  if (!slug) {
    throw new Error(
      'Unable to resolve business context. Set BUSINESS_SLUG or ensure user is authenticated.'
    )
  }

  // TODO: cache this DB lookup
  const { db } = await import('./db')
  const business = await db.business.findUnique({ where: { slug } })
  if (!business) throw new Error(`Business not found for slug: ${slug}`)

  return business.id
}
