'use server'

import { db } from '@/lib/db'
import { getCustomerSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { revalidatePath } from 'next/cache'

export async function setCustomerAccountTypeAction(params: {
  type: 'personal' | 'business'
  businessName?: string
}) {
  const session = await getCustomerSession()
  if (!session) throw new Error('Not authenticated')

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) throw new Error('Customer record not found')

  await db.customer.update({
    where: { id: customer.id },
    data: {
      isBusinessAccount: params.type === 'business',
      businessName: params.type === 'business' ? (params.businessName ?? null) : null,
    },
  })

  revalidatePath('/')
}
