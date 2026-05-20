import { createHash } from 'crypto'
import { db } from './db'
import { normalizePhone } from './utils'

type AddressSnapshot = {
  street: string
  suburb: string
  city: string
  province: string
  postalCode?: string | null
  locationNodeId?: string | null
  lat?: number | null
  lng?: number | null
  label?: string | null
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
}

type CustomerAddressRow = {
  id: string
  customerId: string
  label: string | null
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string | null
  lat: number | null
  lng: number | null
  locationNodeId: string | null
  isDefault: boolean
  createdAt: Date
  locationNode?: { regionKey: string | null } | null
}

type AddressRow = {
  id: string
  street: string
  addressLine1: string | null
  addressLine2: string | null
  complexName: string | null
  unitNumber: string | null
  suburb: string
  city: string
  province: string
  postalCode: string | null
  locationNodeId: string | null
  isDefault: boolean
  createdAt: Date
  locationNode?: { regionKey: string | null } | null
}

type CustomerAddressClient = {
  findMany: (args: any) => Promise<CustomerAddressRow[]>
  create: (args: any) => Promise<CustomerAddressRow>
  update: (args: any) => Promise<CustomerAddressRow>
}

type AddressClient = {
  findMany: (args: any) => Promise<AddressRow[]>
}

export type ReusableAddressTx = {
  customerAddress: CustomerAddressClient
}

export type ResolvedCustomerSavedSite = {
  id: string
  label: string | null
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string | null
  locationNodeId: string | null
  locationNode?: { regionKey: string | null } | null
  addressLine2?: string | null
  complexName?: string | null
  unitNumber?: string | null
}

function normalizedText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function fingerprintAddress(input: {
  street: string
  suburb: string
  city: string
  province: string
  postalCode?: string | null
  locationNodeId?: string | null
}) {
  return [
    normalizedText(input.street),
    normalizedText(input.suburb),
    normalizedText(input.city),
    normalizedText(input.province),
    normalizedText(input.postalCode ?? ''),
    normalizedText(input.locationNodeId ?? ''),
  ].join('|')
}

function hashNormalizedPhone(phone: string | null | undefined) {
  if (!phone) return null
  const normalized = normalizePhone(phone)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

export async function syncReusableCustomerAddressFromSnapshot(
  tx: ReusableAddressTx,
  params: {
    customerId: string
    authUserId?: string | null
    customerPhone?: string | null
    source: 'whatsapp' | 'pwa' | 'merged'
    snapshot: AddressSnapshot
  },
): Promise<{ customerAddressId: string; created: boolean; wasDefault: boolean }> {
  const snapshotKey = fingerprintAddress(params.snapshot)
  const existing = await tx.customerAddress.findMany({
    where: { customerId: params.customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    take: 25,
  })

  const matched = existing.find((row) => fingerprintAddress(row) === snapshotKey)
  if (matched) {
    const updated = await tx.customerAddress.update({
      where: { id: matched.id },
      data: {
        label: matched.label ?? params.snapshot.label ?? null,
        street: params.snapshot.street,
        suburb: params.snapshot.suburb,
        city: params.snapshot.city,
        province: params.snapshot.province,
        postalCode: params.snapshot.postalCode ?? null,
        locationNodeId: params.snapshot.locationNodeId ?? null,
        lat: params.snapshot.lat ?? null,
        lng: params.snapshot.lng ?? null,
      },
      include: { locationNode: { select: { regionKey: true } } },
    })

    console.info('[customer-address-book] reusable address matched', {
      source: params.source,
      authUserId: params.authUserId ?? null,
      customerId: params.customerId,
      phoneHash: hashNormalizedPhone(params.customerPhone),
      addressId: updated.id,
      resolution: matched.isDefault ? 'default' : 'recent',
      created: false,
    })

    return {
      customerAddressId: updated.id,
      created: false,
      wasDefault: updated.isDefault,
    }
  }

  const shouldBeDefault = existing.length === 0 || !existing.some((row) => row.isDefault)
  const created = await tx.customerAddress.create({
    data: {
      customerId: params.customerId,
      label: params.snapshot.label ?? null,
      street: params.snapshot.street,
      suburb: params.snapshot.suburb,
      city: params.snapshot.city,
      province: params.snapshot.province,
      postalCode: params.snapshot.postalCode ?? null,
      locationNodeId: params.snapshot.locationNodeId ?? null,
      lat: params.snapshot.lat ?? null,
      lng: params.snapshot.lng ?? null,
      isDefault: shouldBeDefault,
    },
    include: { locationNode: { select: { regionKey: true } } },
  })

  console.info('[customer-address-book] reusable address created', {
    source: params.source,
    authUserId: params.authUserId ?? null,
    customerId: params.customerId,
    phoneHash: hashNormalizedPhone(params.customerPhone),
    addressId: created.id,
    resolution: created.isDefault ? 'default' : 'newly_created',
    created: true,
  })

  return {
    customerAddressId: created.id,
    created: true,
    wasDefault: created.isDefault,
  }
}

function mergeAddressSnapshotFields(
  reusableSites: CustomerAddressRow[],
  snapshots: AddressRow[],
): ResolvedCustomerSavedSite[] {
  const snapshotByFingerprint = new Map<string, AddressRow>()
  for (const row of snapshots) {
    const key = fingerprintAddress(row)
    if (!snapshotByFingerprint.has(key)) snapshotByFingerprint.set(key, row)
  }

  return reusableSites.map((site) => {
    const snapshot = snapshotByFingerprint.get(fingerprintAddress(site))
    return {
      id: site.id,
      label: site.label,
      street: site.street,
      suburb: site.suburb,
      city: site.city,
      province: site.province,
      postalCode: site.postalCode ?? null,
      locationNodeId: site.locationNodeId ?? null,
      locationNode: site.locationNode ?? null,
      addressLine2: snapshot?.addressLine2 ?? null,
      complexName: snapshot?.complexName ?? null,
      unitNumber: snapshot?.unitNumber ?? null,
    }
  })
}

export async function resolveReusableCustomerSites(params: {
  customerId: string
  authUserId?: string | null
  customerPhone?: string | null
  source: 'whatsapp' | 'pwa' | 'merged'
  limit?: number
}): Promise<ResolvedCustomerSavedSite[]> {
  const limit = params.limit ?? 8
  const fetchReusable = async () => {
    const [reusable, snapshots] = await Promise.all([
      db.customerAddress.findMany({
        where: { customerId: params.customerId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: { locationNode: { select: { regionKey: true } } },
        take: limit,
      }),
      db.address.findMany({
        where: { customerId: params.customerId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        include: { locationNode: { select: { regionKey: true } } },
        take: 25,
      }),
    ])
    return { reusable, snapshots }
  }

  const initial = await fetchReusable()
  if (initial.reusable.length > 0) {
    return mergeAddressSnapshotFields(initial.reusable, initial.snapshots)
  }

  const promotable = initial.snapshots.filter((row) => Boolean(row.locationNodeId)).slice(0, limit)
  if (promotable.length === 0) {
    return []
  }

  await db.$transaction(async (tx) => {
    for (const snapshot of promotable) {
      await syncReusableCustomerAddressFromSnapshot(tx as unknown as ReusableAddressTx, {
        customerId: params.customerId,
        authUserId: params.authUserId ?? null,
        customerPhone: params.customerPhone ?? null,
        source: params.source,
        snapshot: {
          label: snapshot.addressLine1 ?? snapshot.street,
          street: snapshot.street,
          suburb: snapshot.suburb,
          city: snapshot.city,
          province: snapshot.province,
          postalCode: snapshot.postalCode ?? null,
          locationNodeId: snapshot.locationNodeId ?? null,
          lat: null,
          lng: null,
          addressLine2: snapshot.addressLine2 ?? null,
          complexName: snapshot.complexName ?? null,
          unitNumber: snapshot.unitNumber ?? null,
        },
      })
    }
  })

  const promoted = await fetchReusable()
  return mergeAddressSnapshotFields(promoted.reusable, promoted.snapshots)
}
