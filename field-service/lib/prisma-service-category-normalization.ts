import { Prisma } from '@prisma/client'

import {
  canonicalizeServiceCategoryValue,
  canonicalizeServiceCategoryValues,
} from './service-category-canonicalization'

type AnyRecord = Record<string, unknown>
type TargetFieldKind = 'array' | 'scalar'

const WRITE_OPERATIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert'])

const TARGET_FIELDS: Record<string, Record<string, TargetFieldKind>> = {
  Provider: { skills: 'array' },
  ProviderApplication: { skills: 'array' },
  JobRequest: { category: 'scalar' },
  ServiceAreaWaitlist: { category: 'scalar' },
}

const RELATION_KEY_TO_MODEL: Record<string, string> = {
  provider: 'Provider',
  providers: 'Provider',
  providerApplication: 'ProviderApplication',
  providerApplications: 'ProviderApplication',
  jobRequest: 'JobRequest',
  jobRequests: 'JobRequest',
  serviceAreaWaitlist: 'ServiceAreaWaitlist',
  serviceAreaWaitlists: 'ServiceAreaWaitlist',
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeScalarValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return canonicalizeServiceCategoryValue(value).canonical ?? value
  }
  if (isRecord(value) && typeof value.set === 'string') {
    value.set = canonicalizeServiceCategoryValue(value.set).canonical ?? value.set
  }
  return value
}

function normalizeArrayValue(value: unknown): unknown {
  if (Array.isArray(value)) return canonicalizeServiceCategoryValues(value.map(String))

  if (isRecord(value)) {
    if (Array.isArray(value.set)) value.set = canonicalizeServiceCategoryValues(value.set.map(String))
    if (Array.isArray(value.push)) value.push = canonicalizeServiceCategoryValues(value.push.map(String))
    if (typeof value.push === 'string') {
      value.push = canonicalizeServiceCategoryValue(value.push).canonical ?? value.push
    }
  }

  return value
}

function normalizeTargetFields(model: string, data: AnyRecord) {
  const fieldConfig = TARGET_FIELDS[model]
  if (!fieldConfig) return

  for (const [field, kind] of Object.entries(fieldConfig)) {
    if (!(field in data)) continue
    data[field] = kind === 'array'
      ? normalizeArrayValue(data[field])
      : normalizeScalarValue(data[field])
  }
}

function normalizeModelData(model: string, data: unknown) {
  if (Array.isArray(data)) {
    for (const item of data) normalizeModelData(model, item)
    return
  }
  if (!isRecord(data)) return

  normalizeTargetFields(model, data)

  for (const [key, value] of Object.entries(data)) {
    const relatedModel = RELATION_KEY_TO_MODEL[key]
    if (relatedModel) normalizeNestedRelation(relatedModel, value)
  }
}

function normalizeNestedRelation(model: string, payload: unknown) {
  if (Array.isArray(payload)) {
    for (const item of payload) normalizeNestedRelation(model, item)
    return
  }
  if (!isRecord(payload)) return

  for (const [operation, value] of Object.entries(payload)) {
    switch (operation) {
      case 'create':
      case 'update':
        normalizeModelData(model, value)
        break
      case 'createMany':
        if (isRecord(value)) normalizeModelData(model, value.data)
        break
      case 'updateMany':
        if (Array.isArray(value)) {
          for (const item of value) {
            if (isRecord(item)) normalizeModelData(model, item.data)
          }
        } else if (isRecord(value)) {
          normalizeModelData(model, value.data)
        }
        break
      case 'upsert':
        if (Array.isArray(value)) {
          for (const item of value) normalizeNestedRelation(model, { upsert: item })
        } else if (isRecord(value)) {
          normalizeModelData(model, value.create)
          normalizeModelData(model, value.update)
        }
        break
      case 'connectOrCreate':
        if (Array.isArray(value)) {
          for (const item of value) {
            if (isRecord(item)) normalizeModelData(model, item.create)
          }
        } else if (isRecord(value)) {
          normalizeModelData(model, value.create)
        }
        break
      default:
        break
    }
  }
}

export function normalizeServiceCategoryPrismaArgs(
  model: string | undefined,
  operation: string | undefined,
  args: unknown,
) {
  if (!model || !operation || !WRITE_OPERATIONS.has(operation) || !isRecord(args)) return args

  if ('data' in args) normalizeModelData(model, args.data)
  if ('create' in args) normalizeModelData(model, args.create)
  if ('update' in args) normalizeModelData(model, args.update)

  return args
}

export const serviceCategoryCanonicalizationExtension = Prisma.defineExtension({
  name: 'service-category-canonicalization',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        normalizeServiceCategoryPrismaArgs(model, operation, args)
        return query(args)
      },
    },
  },
})
