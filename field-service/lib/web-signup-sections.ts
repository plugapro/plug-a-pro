import { z } from 'zod'

export const SECTION_KEYS = [
  'name', 'identity', 'skills', 'service_areas', 'availability', 'rates', 'profile_photo', 'bio', 'references', 'evidence',
] as const
export type SectionKey = typeof SECTION_KEYS[number]

export interface SectionDef {
  key: SectionKey
  fields: readonly string[]
  schema: z.ZodRawShape
}

export const SECTION_REGISTRY: readonly SectionDef[] = [
  { key: 'name',          fields: ['name'],
    schema: { name: z.string().min(2, 'Full name required') } },
  { key: 'identity',      fields: ['idNumber'],
    schema: { idNumber: z.string().regex(/^\d{13}$/, '13-digit SA ID required') } },
  { key: 'skills',        fields: ['skills'],
    schema: { skills: z.array(z.string()).min(1, 'Pick at least one skill') } },
  { key: 'service_areas', fields: ['regionLabel', 'cityLabel'],
    schema: { regionLabel: z.string().min(1), cityLabel: z.string().min(1) } },
  { key: 'availability',  fields: ['availability'],
    schema: { availability: z.array(z.enum(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])).min(1) } },
  { key: 'rates',         fields: ['hourlyRate'],
    schema: { hourlyRate: z.coerce.number().int().min(50).max(5000) } },
  { key: 'profile_photo', fields: ['profilePhotoUrl'],
    schema: { profilePhotoUrl: z.string().url() } },
  { key: 'bio',           fields: ['bio'],
    schema: { bio: z.string().min(20).max(500) } },
  { key: 'references',    fields: ['references'],
    schema: { references: z.string().min(10).max(500) } },
  { key: 'evidence',      fields: ['evidenceFileUrls'],
    schema: { evidenceFileUrls: z.array(z.string().url()).optional() } },
]

function isFieldCaptured(data: Record<string, unknown>, field: string): boolean {
  const v = data[field]
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function selectMissingSections(data: Record<string, unknown>): readonly SectionDef[] {
  return SECTION_REGISTRY.filter((s) => {
    if (s.key === 'identity') {
      // Don't prompt for SA ID if the provider deferred verification or already
      // uploaded verification documents during WhatsApp onboarding.
      if (data.verificationMethod === 'skipped') return false
      if (typeof data.verificationDocAttachmentId === 'string' && data.verificationDocAttachmentId) return false
      if (typeof data.verificationSelfieAttachmentId === 'string' && data.verificationSelfieAttachmentId) return false
    }
    return s.fields.some((f) => !isFieldCaptured(data, f))
  })
}

export function buildDynamicSchema(sections: readonly SectionDef[]): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodType<unknown>> = {}
  for (const s of sections) for (const k of Object.keys(s.schema)) shape[k] = (s.schema as Record<string, z.ZodType<unknown>>)[k]
  return z.object(shape as z.ZodRawShape)
}
