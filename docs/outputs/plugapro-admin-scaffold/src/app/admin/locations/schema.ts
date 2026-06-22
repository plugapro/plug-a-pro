import { z } from 'zod';

export const locationTypeEnum = z.enum(['PROVINCE', 'CITY', 'REGION', 'SUBURB']);
export type LocationType = z.infer<typeof locationTypeEnum>;

export const createLocationSchema = z.object({
  type: locationTypeEnum,
  label: z.string().min(1).max(80),
  slug: z.string().min(1).regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits, underscore only'),
  parentId: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationLabelSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
});
export type UpdateLocationLabelInput = z.infer<typeof updateLocationLabelSchema>;

export const locationIdSchema = z.object({ id: z.string() });
export type LocationIdInput = z.infer<typeof locationIdSchema>;
