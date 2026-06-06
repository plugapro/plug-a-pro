import type { Prisma } from '@prisma/client'

import {
  canonicalizeServiceCategoryValue,
  canonicalizeServiceCategoryValues,
  countChangedCanonicalValues,
} from './service-category-canonicalization'

type ArrayRow = {
  id: string
  skills: string[]
  isTestUser?: boolean | null
  cohortName?: string | null
}

type CategoryRow = {
  id: string
  category: string | null
  isTestRequest?: boolean | null
  cohortName?: string | null
}

type BackfillDelegate<Row, Data> = {
  findMany: (args: unknown) => Promise<Row[]>
  update: (args: { where: { id: string }; data: Data }) => Promise<unknown>
}

type SkillCategoryCanonicalizationBackfillDelegates = {
  providerApplication: BackfillDelegate<ArrayRow, { skills: string[] }>
  provider: BackfillDelegate<ArrayRow, { skills: string[] }>
  jobRequest: BackfillDelegate<CategoryRow, { category: string }>
  serviceAreaWaitlist: BackfillDelegate<CategoryRow, { category: string }>
  auditLog: {
    createMany: (args: { data: Prisma.AuditLogCreateManyInput[] }) => Promise<unknown>
  }
}

export type SkillCategoryCanonicalizationBackfillClient = SkillCategoryCanonicalizationBackfillDelegates & {
  $transaction?: <T>(
    callback: (tx: SkillCategoryCanonicalizationBackfillDelegates) => Promise<T>,
  ) => Promise<T>
}

export type SkillCategoryCanonicalizationBackfillOptions = {
  apply?: boolean
  confirmed?: boolean
  actorId?: string
}

export type SkillCategoryCanonicalizationFieldSummary = {
  rowsScanned: number
  rowsChanged: number
  valuesChanged: number
}

export type SkillCategoryCanonicalizationBackfillSummary = {
  mode: 'dry-run' | 'apply'
  totalChangedRows: number
  auditRowsWritten: number
  fields: Record<string, SkillCategoryCanonicalizationFieldSummary>
  changes: Array<{
    entityType: string
    entityId: string
    field: string
    before: string[] | string | null
    after: string[] | string
  }>
}

type Change = SkillCategoryCanonicalizationBackfillSummary['changes'][number] & {
  isTestEvent?: boolean
  cohortName?: string | null
}

function emptyFieldSummary(): SkillCategoryCanonicalizationFieldSummary {
  return { rowsScanned: 0, rowsChanged: 0, valuesChanged: 0 }
}

function recordChange(
  summary: SkillCategoryCanonicalizationBackfillSummary,
  fieldKey: string,
  change: Change,
  valuesChanged: number,
) {
  summary.fields[fieldKey].rowsChanged += 1
  summary.fields[fieldKey].valuesChanged += valuesChanged
  summary.totalChangedRows += 1
  summary.changes.push(change)
}

async function scanArrayField(params: {
  summary: SkillCategoryCanonicalizationBackfillSummary
  fieldKey: string
  entityType: 'ProviderApplication' | 'Provider'
  delegate: BackfillDelegate<ArrayRow, { skills: string[] }>
}) {
  const rows = await params.delegate.findMany({
    select: { id: true, skills: true, isTestUser: true, cohortName: true },
    orderBy: { id: 'asc' },
  })
  params.summary.fields[params.fieldKey].rowsScanned = rows.length

  for (const row of rows) {
    const after = canonicalizeServiceCategoryValues(row.skills)
    if (JSON.stringify(after) === JSON.stringify(row.skills)) continue
    recordChange(params.summary, params.fieldKey, {
      entityType: params.entityType,
      entityId: row.id,
      field: 'skills',
      before: row.skills,
      after,
      isTestEvent: Boolean(row.isTestUser),
      cohortName: row.cohortName,
    }, countChangedCanonicalValues(row.skills, after))
  }
}

async function scanCategoryField(params: {
  summary: SkillCategoryCanonicalizationBackfillSummary
  fieldKey: string
  entityType: 'JobRequest' | 'ServiceAreaWaitlist'
  delegate: BackfillDelegate<CategoryRow, { category: string }>
}) {
  const rows = await params.delegate.findMany({
    select: {
      id: true,
      category: true,
      ...(params.entityType === 'JobRequest' ? { isTestRequest: true, cohortName: true } : {}),
    },
    orderBy: { id: 'asc' },
  })
  params.summary.fields[params.fieldKey].rowsScanned = rows.length

  for (const row of rows) {
    if (!row.category) continue
    const after = canonicalizeServiceCategoryValue(row.category).canonical
    if (!after || after === row.category) continue
    recordChange(params.summary, params.fieldKey, {
      entityType: params.entityType,
      entityId: row.id,
      field: 'category',
      before: row.category,
      after,
      isTestEvent: Boolean(row.isTestRequest),
      cohortName: row.cohortName,
    }, 1)
  }
}

function auditRowsForChanges(changes: Change[], actorId: string): Prisma.AuditLogCreateManyInput[] {
  return changes.map((change) => ({
    actorId,
    actorRole: 'system',
    action: 'service_category.canonicalized',
    entityType: change.entityType,
    entityId: change.entityId,
    before: { [change.field]: change.before },
    after: { [change.field]: change.after },
    reason: 'Canonicalize legacy service category labels to slug tags',
    isTestEvent: Boolean(change.isTestEvent),
    cohortName: change.cohortName ?? undefined,
  }))
}

async function applyChanges(
  client: SkillCategoryCanonicalizationBackfillDelegates,
  changes: Change[],
  actorId: string,
) {
  for (const change of changes) {
    const delegate =
      change.entityType === 'ProviderApplication' ? client.providerApplication :
      change.entityType === 'Provider' ? client.provider :
      change.entityType === 'JobRequest' ? client.jobRequest :
      client.serviceAreaWaitlist

    await delegate.update({
      where: { id: change.entityId },
      data: { [change.field]: change.after } as never,
    })
  }

  const auditRows = auditRowsForChanges(changes, actorId)
  await client.auditLog.createMany({ data: auditRows })
  return auditRows.length
}

export async function runSkillCategoryCanonicalizationBackfill(
  client: SkillCategoryCanonicalizationBackfillClient,
  options: SkillCategoryCanonicalizationBackfillOptions = {},
): Promise<SkillCategoryCanonicalizationBackfillSummary> {
  if (options.apply && !options.confirmed) {
    throw new Error('SKILL_CATEGORY_CANONICALIZATION_CONFIRMATION_REQUIRED')
  }

  const summary: SkillCategoryCanonicalizationBackfillSummary = {
    mode: options.apply ? 'apply' : 'dry-run',
    totalChangedRows: 0,
    auditRowsWritten: 0,
    fields: {
      'ProviderApplication.skills': emptyFieldSummary(),
      'Provider.skills': emptyFieldSummary(),
      'JobRequest.category': emptyFieldSummary(),
      'ServiceAreaWaitlist.category': emptyFieldSummary(),
    },
    changes: [],
  }

  await scanArrayField({
    summary,
    fieldKey: 'ProviderApplication.skills',
    entityType: 'ProviderApplication',
    delegate: client.providerApplication,
  })
  await scanArrayField({
    summary,
    fieldKey: 'Provider.skills',
    entityType: 'Provider',
    delegate: client.provider,
  })
  await scanCategoryField({
    summary,
    fieldKey: 'JobRequest.category',
    entityType: 'JobRequest',
    delegate: client.jobRequest,
  })
  await scanCategoryField({
    summary,
    fieldKey: 'ServiceAreaWaitlist.category',
    entityType: 'ServiceAreaWaitlist',
    delegate: client.serviceAreaWaitlist,
  })

  if (!options.apply || summary.changes.length === 0) return summary

  const actorId = options.actorId ?? 'script:skill-category-canonicalization'
  const changes = summary.changes as Change[]
  summary.auditRowsWritten = client.$transaction
    ? await client.$transaction((tx) => applyChanges(tx, changes, actorId))
    : await applyChanges(client, changes, actorId)

  return summary
}
