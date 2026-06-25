'use server';

// Admin users & roles server actions.
//
// NOTE: The invite action is a STUB for email sending. Wire it to your
// transactional email (WhatsApp magic link, SES, Postmark, Resend, etc.).
// The stub creates the AdminUser row and logs that it would have sent an
// email. Replace `sendInviteEmail()` with your real implementation.

import { Role } from '@prisma/client';
import { crudAction } from '@/lib/crud-action';
import {
  inviteAdminSchema,
  updateAdminRolesSchema,
  toggleAdminSchema,
  revokeAdminSchema,
} from './schema';

export const inviteAdmin = crudAction({
  name: 'adminUser.invite',
  entity: 'AdminUser',
  schema: inviteAdminSchema,
  requiredRole: [Role.OWNER],
  requiredFlag: 'admin.users.v2',
  revalidate: ['/admin/team'],
  auditPayload: (input) => ({ email: input.email, roles: input.roles }),
  run: async (input, ctx) => {
    const existing = await ctx.db.adminUser.findUnique({ where: { email: input.email } });
    if (existing) {
      throw Object.assign(new Error('An admin with that email already exists'), { code: 'P2002' });
    }
    const created = await ctx.db.adminUser.create({
      data: {
        email: input.email,
        name: input.name,
        roles: input.roles as Role[],
        isActive: true,
        invitedBy: ctx.session.user.id,
      },
    });
    await sendInviteEmail(created.email, created.name);
    return { entityId: created.id, created };
  },
});

export const updateAdminRoles = crudAction({
  name: 'adminUser.updateRoles',
  entity: 'AdminUser',
  schema: updateAdminRolesSchema,
  requiredRole: [Role.OWNER],
  requiredFlag: 'admin.users.v2',
  revalidate: ['/admin/team'],
  run: async (input, ctx) => {
    const before = await ctx.db.adminUser.findUniqueOrThrow({ where: { id: input.id } });

    // Safety rail: do not let an OWNER remove their own OWNER role if they are the last owner.
    if (
      input.id === ctx.session.user.id &&
      before.roles.includes('OWNER' as Role) &&
      !input.roles.includes('OWNER' as Role)
    ) {
      const otherOwners = await ctx.db.adminUser.count({
        where: { id: { not: input.id }, isActive: true, roles: { has: 'OWNER' } },
      });
      if (otherOwners === 0) {
        throw new Error('Cannot remove the last OWNER role.');
      }
    }

    const after = await ctx.db.adminUser.update({
      where: { id: input.id },
      data: { roles: input.roles as Role[] },
    });
    return { entityId: input.id, before, after };
  },
});

export const deactivateAdmin = crudAction({
  name: 'adminUser.deactivate',
  entity: 'AdminUser',
  schema: toggleAdminSchema,
  requiredRole: [Role.OWNER],
  requiredFlag: 'admin.users.v2',
  revalidate: ['/admin/team'],
  run: async (input, ctx) => {
    if (input.id === ctx.session.user.id) throw new Error('You cannot deactivate yourself.');
    const after = await ctx.db.adminUser.update({
      where: { id: input.id },
      data: { isActive: false },
    });
    return { entityId: input.id, after };
  },
});

export const reactivateAdmin = crudAction({
  name: 'adminUser.reactivate',
  entity: 'AdminUser',
  schema: toggleAdminSchema,
  requiredRole: [Role.OWNER],
  requiredFlag: 'admin.users.v2',
  revalidate: ['/admin/team'],
  run: async (input, ctx) => {
    const after = await ctx.db.adminUser.update({
      where: { id: input.id },
      data: { isActive: true },
    });
    return { entityId: input.id, after };
  },
});

export const revokeAdmin = crudAction({
  name: 'adminUser.revoke',
  entity: 'AdminUser',
  schema: revokeAdminSchema,
  requiredRole: [Role.OWNER],
  requiredFlag: 'admin.users.v2',
  revalidate: ['/admin/team'],
  auditPayload: (input) => ({ reasonCode: input.reasonCode, note: input.note }),
  run: async (input, ctx) => {
    if (input.id === ctx.session.user.id) throw new Error('You cannot revoke yourself.');
    const after = await ctx.db.adminUser.update({
      where: { id: input.id },
      data: { isActive: false, archivedAt: new Date() },
    });
    return { entityId: input.id, after };
  },
});

// --- Stub ---------------------------------------------------------------

async function sendInviteEmail(email: string, name: string): Promise<void> {
  // TODO: wire to your transactional email / WhatsApp magic-link provider.
  // Keep this function SERVER-ONLY. Never expose the send provider on the
  // client.
  console.info(`[stub] would send admin invite email to ${email} (${name})`);
}
