import { z } from 'zod'

const FORBIDDEN_METADATA_KEY = /(idnumber|idhash|idlast4|identifier|selfie|blob|documenturl|mediaurl|token|secret|accesskey)/i

export const SecurityReviewMetadataSchema = z
  .object({
    webhookEventId: z.string().min(1).optional(),
    vendorKey: z.string().min(1).optional(),
    vendorReference: z.string().min(1).nullable().optional(),
    livenessSessionReference: z.string().min(1).nullable().optional(),
    matchedVerificationIds: z.array(z.string().min(1)).max(20).optional(),
    reasonCode: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Security event metadata contains forbidden key: ${key}`,
        })
      }
    }
  })

export type SanitizedSecurityReviewMetadata = z.infer<typeof SecurityReviewMetadataSchema>

export function sanitizeSecurityReviewMetadata(value: unknown): SanitizedSecurityReviewMetadata {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        throw new Error(`Security event metadata contains forbidden key: ${key}`)
      }
    }
  }
  return SecurityReviewMetadataSchema.parse(value ?? {})
}
