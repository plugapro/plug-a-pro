'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.verifications'

const VendorConfigSchema = z.object({
  vendorKey: z.enum(['smile_id', 'thisisme', 'datanamix', 'omnicheck', 'manual', 'mock']),
  confidenceThreshold: z.coerce.number().min(0).max(1),
  livenessRequired: z.coerce.boolean(),
})

const ToggleActiveSchema = z.object({
  vendorKey: z.enum(['smile_id', 'thisisme', 'datanamix', 'omnicheck', 'manual', 'mock']),
})

type VendorConfigInput = z.infer<typeof VendorConfigSchema>
type ToggleActiveInput = z.infer<typeof ToggleActiveSchema>

export async function updateVendorConfigAction(input: VendorConfigInput) {
  const result = await crudAction<VendorConfigInput, { vendorKey: string }>({
    entity: 'VerificationVendorConfig',
    entityId: input.vendorKey,
    action: 'verification_vendor_config.update',
    requiredRole: ['TRUST', 'OWNER'],
    requiredFlag: FLAG,
    schema: VendorConfigSchema,
    input,
    run: async (data, tx) => {
      const row = await tx.verificationVendorConfig.upsert({
        where: { vendorKey: data.vendorKey },
        create: {
          vendorKey: data.vendorKey,
          active: false,
          confidenceThreshold: data.confidenceThreshold,
          livenessRequired: data.livenessRequired,
        },
        update: {
          confidenceThreshold: data.confidenceThreshold,
          livenessRequired: data.livenessRequired,
        },
      })
      return { vendorKey: row.vendorKey }
    },
  })
  revalidatePath('/admin/verifications/vendors')
  return { ok: result.ok }
}

export async function activateVendorConfigAction(input: ToggleActiveInput) {
  const result = await crudAction<ToggleActiveInput, { vendorKey: string }>({
    entity: 'VerificationVendorConfig',
    entityId: input.vendorKey,
    action: 'verification_vendor_config.activate',
    requiredRole: ['OWNER'],
    requiredFlag: FLAG,
    schema: ToggleActiveSchema,
    input,
    run: async (data, tx) => {
      assertVendorCanBeActivated(data.vendorKey)
      await tx.verificationVendorConfig.updateMany({ data: { active: false } })
      await tx.verificationVendorConfig.upsert({
        where: { vendorKey: data.vendorKey },
        create: { vendorKey: data.vendorKey, active: true },
        update: { active: true },
      })
      return { vendorKey: data.vendorKey }
    },
  })
  revalidatePath('/admin/verifications/vendors')
  return { ok: result.ok }
}

export async function updateVendorConfigFormAction(formData: FormData) {
  await updateVendorConfigAction({
    vendorKey: formData.get('vendorKey')?.toString() as VendorConfigInput['vendorKey'],
    confidenceThreshold: Number(formData.get('confidenceThreshold') ?? 0.9),
    livenessRequired: formData.get('livenessRequired') === 'on',
  })
}

export async function activateVendorConfigFormAction(formData: FormData) {
  await activateVendorConfigAction({
    vendorKey: formData.get('vendorKey')?.toString() as ToggleActiveInput['vendorKey'],
  })
}

export async function seedDefaultVendorConfigs() {
  const vendors = ['manual', 'mock', 'smile_id', 'thisisme', 'datanamix', 'omnicheck'] as const
  await db.$transaction(vendors.map((vendorKey) => db.verificationVendorConfig.upsert({
    where: { vendorKey },
    create: {
      vendorKey,
      active: vendorKey === 'manual',
      confidenceThreshold: 0.9,
      livenessRequired: vendorKey !== 'manual',
      configJson: { displayName: vendorLabel(vendorKey), expectedTurnaroundMinutes: 30 },
    },
    update: {},
  })))
}

function vendorLabel(vendorKey: string) {
  if (vendorKey === 'smile_id') return 'Smile ID'
  if (vendorKey === 'thisisme') return 'ThisIsMe'
  if (vendorKey === 'datanamix') return 'Datanamix'
  if (vendorKey === 'omnicheck') return 'OmniCheck'
  if (vendorKey === 'mock') return 'Mock'
  return 'Manual review'
}

function assertVendorCanBeActivated(vendorKey: ToggleActiveInput['vendorKey']) {
  if (vendorKey === 'mock' && process.env.NODE_ENV === 'production') {
    throw new Error('Mock identity verification provider cannot be activated in production.')
  }
  if (vendorKey === 'thisisme' || vendorKey === 'datanamix' || vendorKey === 'omnicheck') {
    throw new Error(`${vendorLabel(vendorKey)} is scaffolded but not implemented yet.`)
  }
}
