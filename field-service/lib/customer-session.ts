import type { AuthUser } from './auth'

type CustomerRecord = {
  id: string
  userId: string | null
  phone: string
  name: string
  email: string | null
}

type CustomerClient = {
  customer: {
    findUnique: (...args: any[]) => Promise<CustomerRecord | null>
    findFirst: (...args: any[]) => Promise<CustomerRecord | null>
    update: (...args: any[]) => Promise<CustomerRecord>
  }
}

const customerSessionSelect = {
  id: true,
  userId: true,
  phone: true,
  name: true,
  email: true,
} as const

export async function resolveCustomerForSession(
  client: CustomerClient,
  session: AuthUser,
) {
  let customer = await client.customer.findUnique({
    where: { userId: session.id },
    select: customerSessionSelect,
  })

  if (!customer && session.phone) {
    customer = await client.customer.findUnique({
      where: { phone: session.phone },
      select: customerSessionSelect,
    })
  }

  if (customer && !customer.userId) {
    customer = await client.customer.update({
      where: { id: customer.id },
      data: { userId: session.id },
      select: customerSessionSelect,
    })
  }

  return customer
}
