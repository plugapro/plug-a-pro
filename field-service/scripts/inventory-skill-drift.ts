import 'dotenv/config'

import { db } from '../lib/db'
import {
  canonicalizeServiceCategoryValue,
  canonicalizeServiceCategoryValues,
  countChangedCanonicalValues,
} from '../lib/service-category-canonicalization'
import { PILOT_SKILL_TAGS, SERVICE_CATEGORY_OPTIONS } from '../lib/service-categories'

const KNOWN_TAGS = new Set(SERVICE_CATEGORY_OPTIONS.map((option) => option.tag))

type FieldReport = {
  rowsScanned: number
  rowsChanged: number
  valuesChanged: number
  distinct: Map<string, number>
}

function emptyReport(): FieldReport {
  return {
    rowsScanned: 0,
    rowsChanged: 0,
    valuesChanged: 0,
    distinct: new Map(),
  }
}

function classify(value: string) {
  const result = canonicalizeServiceCategoryValue(value)
  if (KNOWN_TAGS.has(value)) return 'canonical'
  if (result.source === 'label') return 'label'
  return 'other'
}

function addDistinct(report: FieldReport, value: string) {
  report.distinct.set(value, (report.distinct.get(value) ?? 0) + 1)
}

function inspectArrayRows(rows: Array<{ skills: string[] }>) {
  const report = emptyReport()
  report.rowsScanned = rows.length

  for (const row of rows) {
    for (const skill of row.skills) addDistinct(report, skill)
    const after = canonicalizeServiceCategoryValues(row.skills)
    const changedValues = countChangedCanonicalValues(row.skills, after)
    if (changedValues > 0) {
      report.rowsChanged += 1
      report.valuesChanged += changedValues
    }
  }

  return report
}

function inspectScalarRows(rows: Array<{ category: string | null }>) {
  const report = emptyReport()
  report.rowsScanned = rows.length

  for (const row of rows) {
    if (!row.category) continue
    addDistinct(report, row.category)
    const after = canonicalizeServiceCategoryValue(row.category).canonical
    if (after && after !== row.category) {
      report.rowsChanged += 1
      report.valuesChanged += 1
    }
  }

  return report
}

function printReport(field: string, report: FieldReport) {
  console.log(`\n[${field}] scanned=${report.rowsScanned} drift_rows=${report.rowsChanged} drift_values=${report.valuesChanged}`)
  for (const [value, count] of [...report.distinct.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${classify(value).padEnd(10)}  ${value}`)
  }
}

function describeMissingSchemaError(error: unknown): string | null {
  const maybeError = error as { code?: string; meta?: { table?: string; column?: string } }
  if (maybeError?.code === 'P2021') return `missing table ${maybeError.meta?.table ?? 'unknown'}`
  if (maybeError?.code === 'P2022') return `missing column ${maybeError.meta?.column ?? 'unknown'}`
  return null
}

async function safeFindMany<T>(field: string, query: () => Promise<T[]>): Promise<T[]> {
  try {
    return await query()
  } catch (error) {
    const reason = describeMissingSchemaError(error)
    if (!reason) throw error
    console.warn(`[${field}] skipped=${reason}`)
    return []
  }
}

async function main() {
  console.log('Canonical tags:', [...KNOWN_TAGS].join(', '))
  console.log('Pilot tags:    ', [...PILOT_SKILL_TAGS].join(', '))

  const [
    applications,
    providers,
    jobs,
    waitlists,
  ] = await Promise.all([
    safeFindMany('ProviderApplication.skills', () => db.providerApplication.findMany({ select: { skills: true } })),
    safeFindMany('Provider.skills', () => db.provider.findMany({ select: { skills: true } })),
    safeFindMany('JobRequest.category', () => db.jobRequest.findMany({ select: { category: true } })),
    safeFindMany('ServiceAreaWaitlist.category', () => db.serviceAreaWaitlist.findMany({ select: { category: true } })),
  ])

  const reports = {
    'ProviderApplication.skills': inspectArrayRows(applications),
    'Provider.skills': inspectArrayRows(providers),
    'JobRequest.category': inspectScalarRows(jobs),
    'ServiceAreaWaitlist.category': inspectScalarRows(waitlists),
  }

  for (const [field, report] of Object.entries(reports)) printReport(field, report)

  const totalDriftRows = Object.values(reports).reduce((sum, report) => sum + report.rowsChanged, 0)
  const totalDriftValues = Object.values(reports).reduce((sum, report) => sum + report.valuesChanged, 0)
  console.log(`\n[summary] drift_rows=${totalDriftRows} drift_values=${totalDriftValues}`)
}

main()
  .catch((error) => {
    console.error('[inventory-skill-drift] failed', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
