import { z } from 'zod';

export const providerStatusEnum = z.enum(['APPLICATION_PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
export const kycStatusEnum = z.enum(['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']);

export const createProviderSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  skills: z.array(z.string()).min(1, 'Pick at least one skill'),
  serviceAreas: z.array(z.string()).min(1, 'Pick at least one service area'),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  skills: z.array(z.string()),
  serviceAreas: z.array(z.string()),
});
export type UpdateProviderProfileInput = z.infer<typeof updateProviderProfileSchema>;

export const setProviderKycSchema = z.object({
  id: z.string(),
  kycStatus: kycStatusEnum,
  note: z.string().optional(),
});

export const suspendProviderSchema = z.object({
  id: z.string(),
  until: z.string().datetime(),
  reasonCode: z.string(),
  note: z.string().optional(),
});

export const deactivateProviderSchema = z.object({
  id: z.string(),
  reasonCode: z.string(),
  note: z.string().optional(),
});

export const certificationSchema = z.object({
  providerId: z.string(),
  id: z.string().optional(), // present on update
  type: z.string().min(1).max(80),
  number: z.string().optional(),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  attachmentUrl: z.string().url().optional(),
});

export const equipmentSchema = z.object({
  providerId: z.string(),
  id: z.string().optional(),
  type: z.string().min(1).max(80),
  notes: z.string().optional(),
});

export const noteSchema = z.object({
  providerId: z.string(),
  body: z.string().min(1).max(2000),
  isStrike: z.boolean().optional().default(false),
});

export const idSchema = z.object({ id: z.string() });
export const providerIdSchema = z.object({ providerId: z.string(), id: z.string() });
