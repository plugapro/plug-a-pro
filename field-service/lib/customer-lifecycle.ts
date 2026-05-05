type CustomerLifecycleTx = {
  customer: {
    findUnique: (args: any) => Promise<any>
    update: (args: any) => Promise<any>
    delete: (args: any) => Promise<any>
  }
  address: { updateMany: (args: any) => Promise<any> }
  customerNote: { updateMany: (args: any) => Promise<any> }
  jobRequest: { count: (args: any) => Promise<number>; updateMany: (args: any) => Promise<any> }
  messageEvent: { updateMany: (args: any) => Promise<any> }
  whatsappPreferenceLog: { updateMany: (args: any) => Promise<any> }
  review: { updateMany: (args: any) => Promise<any> }
  customerMergeEvent: { create: (args: any) => Promise<any> }
}

type MergeCustomersInput = {
  sourceCustomerId: string
  targetCustomerId: string
  executedById: string
  reason: string
}

type PurgeCustomerInput = {
  customerId: string
}

function plus30Days(from: Date) {
  return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000)
}

export async function mergeCustomers(
  tx: CustomerLifecycleTx,
  input: MergeCustomersInput,
) {
  if (input.sourceCustomerId === input.targetCustomerId) {
    throw new Error('Source and target customer must be different.')
  }

  const [source, target] = await Promise.all([
    tx.customer.findUnique({
      where: { id: input.sourceCustomerId },
      select: {
        id: true,
        userId: true,
        phone: true,
        email: true,
        name: true,
        notes: true,
        address: true,
        isBlocked: true,
        blockedReason: true,
        blockedAt: true,
        suspendedUntil: true,
        suspendedReason: true,
        marketingOptIn: true,
        serviceOptIn: true,
      },
    }),
    tx.customer.findUnique({
      where: { id: input.targetCustomerId },
      select: {
        id: true,
        userId: true,
        phone: true,
        email: true,
        name: true,
        notes: true,
        address: true,
        isBlocked: true,
        blockedReason: true,
        blockedAt: true,
        suspendedUntil: true,
        suspendedReason: true,
        marketingOptIn: true,
        serviceOptIn: true,
      },
    }),
  ])

  if (!source || !target) {
    throw new Error('Source or target customer not found.')
  }

  if (source.userId && target.userId && source.userId !== target.userId) {
    throw new Error('Cannot merge customers that are linked to different authenticated accounts.')
  }

  const now = new Date()
  const purgeAfter = plus30Days(now)
  const mergedNotes = [target.notes, source.notes].filter(Boolean).join('\n\n---\n\n') || null
  const nextSuspendedUntil =
    [target.suspendedUntil, source.suspendedUntil]
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null

  await tx.customer.update({
    where: { id: target.id },
    data: {
      userId: target.userId ?? source.userId ?? null,
      email: target.email ?? source.email ?? null,
      address: target.address ?? source.address ?? null,
      notes: mergedNotes,
      isBlocked: target.isBlocked || source.isBlocked,
      blockedReason: target.blockedReason ?? source.blockedReason ?? null,
      blockedAt: target.blockedAt ?? source.blockedAt ?? null,
      suspendedUntil: nextSuspendedUntil,
      suspendedReason: target.suspendedReason ?? source.suspendedReason ?? null,
      marketingOptIn: target.marketingOptIn || source.marketingOptIn,
      serviceOptIn: target.serviceOptIn || source.serviceOptIn,
    },
  })

  await tx.address.updateMany({
    where: { customerId: source.id },
    data: { customerId: target.id },
  })
  await tx.customerNote.updateMany({
    where: { customerId: source.id },
    data: { customerId: target.id },
  })
  await tx.jobRequest.updateMany({
    where: { customerId: source.id },
    data: { customerId: target.id },
  })
  await tx.messageEvent.updateMany({
    where: { customerId: source.id },
    data: { customerId: target.id },
  })
  await tx.whatsappPreferenceLog.updateMany({
    where: { customerId: source.id },
    data: { customerId: target.id },
  })
  await tx.review.updateMany({
    where: { customerId: source.id },
    data: { customerId: target.id },
  })

  await tx.customer.update({
    where: { id: source.id },
    data: {
      userId: null,
      active: false,
      archivedAt: now,
      archiveReason: `Merged into ${target.id}: ${input.reason}`,
      purgeAfter,
      mergedIntoCustomerId: target.id,
    },
  })

  await tx.customerMergeEvent.create({
    data: {
      sourceCustomerId: source.id,
      targetCustomerId: target.id,
      executedById: input.executedById,
      reason: input.reason,
      metadata: {
        sourcePhone: source.phone,
        targetPhone: target.phone,
      },
    },
  })

  return {
    id: target.id,
    mergedSourceId: source.id,
    purgeAfter,
  }
}

export async function purgeArchivedCustomer(
  tx: CustomerLifecycleTx,
  input: PurgeCustomerInput,
) {
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      archivedAt: true,
      purgeAfter: true,
    },
  })

  if (!customer) {
    throw new Error('Customer not found.')
  }

  if (!customer.archivedAt || !customer.purgeAfter) {
    throw new Error('Customer must be archived before purge.')
  }

  if (customer.purgeAfter > new Date()) {
    throw new Error('Customer is not yet eligible for purge.')
  }

  const jobRequestCount = await tx.jobRequest.count({
    where: { customerId: customer.id },
  })

  if (jobRequestCount > 0) {
    throw new Error('Customer cannot be purged while job requests still reference the record.')
  }

  await tx.messageEvent.updateMany({
    where: { customerId: customer.id },
    data: { customerId: null },
  })
  await tx.review.updateMany({
    where: { customerId: customer.id },
    data: { customerId: null },
  })

  await tx.customer.delete({
    where: { id: customer.id },
  })

  return { id: customer.id, purged: true as const }
}
