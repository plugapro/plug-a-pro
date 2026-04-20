'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { createServiceClient } from '@/lib/auth'
import { db } from '@/lib/db'
import type { Role } from '@prisma/client'

const FLAG = 'admin.users.v2'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const InviteAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: z.enum(['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER']),
})

const ChangeRoleSchema = z.object({
  adminUserId: z.string().min(1),
  role: z.enum(['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER']),
})

const DeactivateAdminSchema = z.object({
  adminUserId: z.string().min(1),
})

type InviteInput = z.infer<typeof InviteAdminSchema>
type ChangeRoleInput = z.infer<typeof ChangeRoleSchema>
type DeactivateInput = z.infer<typeof DeactivateAdminSchema>

// ─── inviteAdmin ──────────────────────────────────────────────────────────────

export async function inviteAdminAction(input: InviteInput) {
  const result = await crudAction<InviteInput, { id: string; email: string }>({
    entity: 'AdminUser',
    action: 'admin.invite',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: InviteAdminSchema,
    input,
    run: async (data, tx) => {
      // Check for existing AdminUser with this email
      const existing = await tx.adminUser.findUnique({
        where: { email: data.email },
        select: { id: true, active: true },
      })
      if (existing) {
        if (existing.active) {
          throw new CrudActionError('CONFLICT', `An admin with email ${data.email} already exists.`)
        }
        // Re-activate a deactivated account
        const updated = await tx.adminUser.update({
          where: { id: existing.id },
          data: { active: true, role: data.role as Role, name: data.name },
          select: { id: true, email: true },
        })
        return updated
      }

      // Create a placeholder AdminUser row — userId will be populated when
      // the invited user first signs in via the Supabase magic link.
      // We use email as a stable identifier until they authenticate.
      const adminUser = await tx.adminUser.create({
        data: {
          userId: `pending:${data.email}`,
          email: data.email,
          name: data.name,
          role: data.role as Role,
          active: true,
        },
        select: { id: true, email: true },
      })
      return adminUser
    },
  })

  // Send Supabase invite email outside the transaction (non-atomic by design —
  // the AdminUser row is the source of truth; email delivery is best-effort)
  try {
    const supabase = createServiceClient()
    await supabase.auth.admin.inviteUserByEmail(input.email, {
      data: { role: 'admin', name: input.name },
    })
  } catch (emailErr) {
    // Log but don't fail — the admin row exists; the invite can be resent
    console.error('[inviteAdmin] Supabase invite email failed:', emailErr)
  }

  revalidatePath('/admin/team')
  return result
}

// ─── changeRole ───────────────────────────────────────────────────────────────

export async function changeRoleAction(input: ChangeRoleInput) {
  const result = await crudAction<ChangeRoleInput, { id: string }>({
    entity: 'AdminUser',
    entityId: input.adminUserId,
    action: 'admin.change_role',
    requiredRole: ['OWNER'],
    requiredFlag: FLAG,
    schema: ChangeRoleSchema,
    input,
    run: async (data, tx) => {
      const adminUser = await tx.adminUser.findUnique({
        where: { id: data.adminUserId },
        select: { id: true },
      })
      if (!adminUser) {
        throw new CrudActionError('NOT_FOUND', `AdminUser ${data.adminUserId} not found.`)
      }
      await tx.adminUser.update({
        where: { id: data.adminUserId },
        data: { role: data.role as Role },
      })
      return { id: data.adminUserId }
    },
  })
  revalidatePath('/admin/team')
  return result
}

// ─── deactivateAdmin ──────────────────────────────────────────────────────────

export async function deactivateAdminAction(input: DeactivateInput) {
  const result = await crudAction<DeactivateInput, { id: string }>({
    entity: 'AdminUser',
    entityId: input.adminUserId,
    action: 'admin.deactivate',
    requiredRole: ['OWNER'],
    requiredFlag: FLAG,
    schema: DeactivateAdminSchema,
    input,
    run: async (data, tx) => {
      const adminUser = await tx.adminUser.findUnique({
        where: { id: data.adminUserId },
        select: { id: true },
      })
      if (!adminUser) {
        throw new CrudActionError('NOT_FOUND', `AdminUser ${data.adminUserId} not found.`)
      }
      await tx.adminUser.update({
        where: { id: data.adminUserId },
        data: { active: false },
      })
      return { id: data.adminUserId }
    },
  })
  revalidatePath('/admin/team')
  return result
}

// ─── FormData wrappers ────────────────────────────────────────────────────────

export async function inviteAdminFromFormAction(formData: FormData) {
  try {
    return await inviteAdminAction({
      email: (formData.get('email') as string ?? '').trim(),
      name: (formData.get('name') as string ?? '').trim(),
      role: formData.get('role') as InviteInput['role'],
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to send invite' }
  }
}

export async function changeRoleFromFormAction(formData: FormData) {
  try {
    return await changeRoleAction({
      adminUserId: formData.get('adminUserId') as string,
      role: formData.get('role') as ChangeRoleInput['role'],
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to change role' }
  }
}

export async function deactivateAdminFromFormAction(adminUserId: string) {
  try {
    return await deactivateAdminAction({ adminUserId })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to deactivate admin' }
  }
}
