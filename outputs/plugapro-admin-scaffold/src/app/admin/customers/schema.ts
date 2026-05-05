import { z } from 'zod';

export const customerChannelEnum = z.enum(['WHATSAPP', 'PWA', 'BOTH']);

export const customerInternalFlagEnum = z.enum([
  'VIP',
  'HIGH_RISK',
  'DO_NOT_CONTACT_AFTER_18',
  'PAYMENT_RISK',
  'FRAUD_SUSPECTED',
]);

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Required').max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/, 'Enter a valid phone number'),
  email: z.string().email().optional().or(z.literal('')),
  channel: customerChannelEnum.default('WHATSAPP'),
  address: z.string().max(500).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  email: z.string().email().optional().or(z.literal('')),
  channel: customerChannelEnum,
  address: z.string().max(500).optional(),
  internalFlags: z.array(customerInternalFlagEnum).optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const blockCustomerSchema = z.object({
  id: z.string(),
  reasonCode: z.string(),
  note: z.string().optional(),
});

export const suspendCustomerSchema = z.object({
  id: z.string(),
  until: z.string().datetime(),
  reasonCode: z.string(),
  note: z.string().optional(),
});

export const archiveCustomerSchema = z.object({
  id: z.string(),
  reasonCode: z.string(),
  note: z.string().optional(),
});

export const mergeCustomersSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  reasonCode: z.string(),
  note: z.string().optional(),
});

export const addNoteSchema = z.object({
  customerId: z.string(),
  body: z.string().min(1).max(2000),
});
export type AddNoteInput = z.infer<typeof addNoteSchema>;
