'use server'

import { z } from 'zod'
import { customerAction } from '@/lib/customer-action'
import { revalidatePath } from 'next/cache'

const accountTypeSchema = z.object({
  type: z.enum(['personal', 'business']),
  businessName: z.string().trim().optional(),
})

export async function setCustomerAccountTypeAction(params: {
  type: 'personal' | 'business'
  businessName?: string
}) {
  await customerAction({
    entity: 'Customer',
    action: 'update_account_type',
    schema: accountTypeSchema,
    input: params,
    run: async (validated, customer, tx) => {
      return tx.customer.update({
        where: { id: customer.id },
        data: {
          isBusinessAccount: validated.type === 'business',
          businessName: validated.type === 'business' ? (validated.businessName ?? null) : null,
        },
        select: { id: true, isBusinessAccount: true, businessName: true },
      })
    },
  })

  revalidatePath('/')
}
