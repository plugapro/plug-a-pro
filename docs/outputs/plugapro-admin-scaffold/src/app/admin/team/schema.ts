import { z } from 'zod';

export const roleEnum = z.enum(['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER']);

export const inviteAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  roles: z.array(roleEnum).min(1, 'Assign at least one role'),
});
export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;

export const updateAdminRolesSchema = z.object({
  id: z.string(),
  roles: z.array(roleEnum).min(1),
});

export const toggleAdminSchema = z.object({
  id: z.string(),
});

export const revokeAdminSchema = z.object({
  id: z.string(),
  reasonCode: z.string(),
  note: z.string().optional(),
});
