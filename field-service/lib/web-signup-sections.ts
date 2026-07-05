import { z } from 'zod'
import { MIN_EVIDENCE_PHOTOS } from '@/lib/provider-onboarding/quality-gate'
import { hasHighRiskServiceSelection } from '@/lib/service-category-policy'

export const SECTION_KEYS = [
  'name', 'identity', 'skills', 'service_areas', 'availability', 'rates', 'profile_photo', 'bio', 'references', 'evidence', 'certification',
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
  { key: 'certification', fields: ['certificationRef'],
    schema: { certificationRef: z.string().min(1, 'Certification or registration number required') } },
]

export interface SectionOpts {
  gateEnabled?: boolean
}

function isFieldCaptured(data: Record<string, unknown>, field: string): boolean {
  const v = data[field]
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function selectMissingSections(data: Record<string, unknown>, opts: SectionOpts = {}): readonly SectionDef[] {
  const { gateEnabled = false } = opts
  const skills = Array.isArray(data.skills) ? (data.skills as string[]) : []
  // Skills are being collected in-form when they weren't already captured. In that
  // case the user's high-risk selection isn't known server-side yet, so we cannot
  // decide the certification section from captured skills alone.
  const skillsSectionShown = !isFieldCaptured(data, 'skills')

  return SECTION_REGISTRY.filter((s) => {
    if (s.key === 'identity') {
      if (data.verificationMethod === 'skipped') return false
      if (typeof data.verificationDocAttachmentId === 'string' && data.verificationDocAttachmentId) return false
      if (typeof data.verificationSelfieAttachmentId === 'string' && data.verificationSelfieAttachmentId) return false
    }

    if (s.key === 'certification') {
      if (!gateEnabled) return false
      // Fix 5: when skills are selected IN THE FORM (skills section shown), the
      // high-risk decision can only be made client-side from the live selection.
      // Include the certification section so a field exists to fill; the client
      // renders it only when the watched selection is high-risk, and the schema
      // for certificationRef is made optional in buildDynamicSchema for this case
      // (server still enforces QUALITY_GATE_CERTIFICATION at submit). Without this,
      // an in-form high-risk selection had no cert field → guaranteed stuck-submit.
      if (skillsSectionShown) return true
      if (!hasHighRiskServiceSelection(skills)) return false
      return !isFieldCaptured(data, 'certificationRef')
    }

    // When the gate is ON and evidence is the section under evaluation, re-prompt
    // even if some URLs are already present but the count is below the minimum.
    // Gate OFF → fall through to the generic captured-field check (unchanged).
    if (s.key === 'evidence' && gateEnabled) {
      const captured = Array.isArray(data.evidenceFileUrls) ? (data.evidenceFileUrls as string[]).length : 0
      return captured < MIN_EVIDENCE_PHOTOS
    }

    return s.fields.some((f) => !isFieldCaptured(data, f))
  })
}

export function buildDynamicSchema(sections: readonly SectionDef[], opts: SectionOpts = {}): z.ZodObject<z.ZodRawShape> {
  const { gateEnabled = false } = opts
  const shape: Record<string, z.ZodType<unknown>> = {}

  // Fix 5: when the skills section is also being collected in-form, the cert
  // section is included unconditionally (see selectMissingSections). The user's
  // selection may be non-high-risk, which must NOT demand a cert — so the
  // certificationRef field is optional client-side here. The server re-checks the
  // resolved skills at submit and still rejects a high-risk selection missing a
  // cert (QUALITY_GATE_CERTIFICATION), so this only relaxes the client schema.
  const skillsSectionInForm = sections.some((s) => s.key === 'skills')

  for (const s of sections) {
    for (const k of Object.keys(s.schema)) {
      let fieldSchema = (s.schema as Record<string, z.ZodType<unknown>>)[k]

      // When gate is ON, evidence must have at least MIN_EVIDENCE_PHOTOS URLs.
      if (s.key === 'evidence' && k === 'evidenceFileUrls' && gateEnabled) {
        fieldSchema = z.array(z.string().url()).min(
          MIN_EVIDENCE_PHOTOS,
          `At least ${MIN_EVIDENCE_PHOTOS} work photos required`,
        )
      }

      // Fix 5: relax certificationRef to optional when skills are chosen in-form.
      if (s.key === 'certification' && k === 'certificationRef' && skillsSectionInForm) {
        fieldSchema = z.string().optional()
      }

      shape[k] = fieldSchema
    }
  }

  return z.object(shape as z.ZodRawShape)
}
