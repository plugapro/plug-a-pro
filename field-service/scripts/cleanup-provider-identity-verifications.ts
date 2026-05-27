import { writeFileSync } from 'fs'
import { db } from '../lib/db'
import {
  deleteIdentityDocumentByBlobKey,
  type IdentityDocumentDeleteResult,
} from '../lib/storage'

type VerificationStatusToKeep = 'PASSED'

type CleanupDocument = {
  id: string
  blobKey: string
}

type CleanupSecurityEvent = {
  id: string
  eventType: string
  severity?: string
  status?: string
}

type CleanupVerificationRow = {
  id: string
  providerId: string | null
  status: string
  documents: CleanupDocument[]
  securityEvents: CleanupSecurityEvent[]
}

export type CleanupPlan = {
  providerId: string
  keepStatus: VerificationStatusToKeep
  targetRows: CleanupVerificationRow[]
  verificationIds: string[]
  blobKeys: string[]
  blockingSecurityEvents: Array<{
    verificationId: string
    securityEventId: string
    eventType: string
  }>
}

type PlanClient = {
  providerIdentityVerification: {
    findMany(args: unknown): Promise<CleanupVerificationRow[]>
  }
}

type CleanupTransaction = {
  securityEvent: {
    deleteMany(args: unknown): Promise<unknown>
  }
  providerIdentityVerification: {
    deleteMany(args: unknown): Promise<unknown>
  }
  auditLog: {
    create(args: unknown): Promise<unknown>
  }
}

type ExecuteClient = {
  $transaction(callback: (tx: CleanupTransaction) => Promise<void>): Promise<void>
}

type DeleteBlob = (blobKey: string) => Promise<IdentityDocumentDeleteResult>

const AUDIT_VALUED_SECURITY_EVENT_TYPES = new Set([
  'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
  'WEBHOOK_SIGNATURE_INVALID_REPEATED',
  'IDENTITY_VERIFICATION_PILOT_BREACH',
])

type ExecuteCleanupInput = {
  plan: CleanupPlan
  adminId: string
  confirm: boolean
  client: ExecuteClient
  deleteBlob: DeleteBlob
  now?: Date
}

export type ExecuteCleanupResult = {
  exitCode: 0 | 2
  committed: boolean
  purgeFailures: Array<{
    blobKey: string
    backend: IdentityDocumentDeleteResult['backend']
    error: string
  }>
}

export async function planCleanup(params: {
  providerId: string
  keepStatus: VerificationStatusToKeep
  client?: PlanClient
}): Promise<CleanupPlan> {
  const client = params.client ?? db
  const targetRows = await client.providerIdentityVerification.findMany({
    where: {
      providerId: params.providerId,
      status: { not: params.keepStatus },
    },
    include: {
      documents: { select: { id: true, blobKey: true } },
      securityEvents: { select: { id: true, eventType: true, severity: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return {
    providerId: params.providerId,
    keepStatus: params.keepStatus,
    targetRows,
    verificationIds: targetRows.map((row) => row.id),
    blobKeys: targetRows.flatMap((row) => row.documents.map((document) => document.blobKey)),
    blockingSecurityEvents: targetRows.flatMap((row) =>
      row.securityEvents
        .filter((event) => AUDIT_VALUED_SECURITY_EVENT_TYPES.has(event.eventType))
        .map((event) => ({
          verificationId: row.id,
          securityEventId: event.id,
          eventType: event.eventType,
        })),
    ),
  }
}

export async function executeCleanupPlan(
  input: ExecuteCleanupInput,
): Promise<ExecuteCleanupResult> {
  const { plan, adminId, confirm, client, deleteBlob } = input
  if (plan.blockingSecurityEvents.length > 0) {
    const details = plan.blockingSecurityEvents
      .map((event) => `${event.securityEventId}:${event.eventType}:${event.verificationId}`)
      .join(', ')
    throw new Error(`Cleanup blocked by security_events referencing target verifications: ${details}`)
  }

  if (!confirm) {
    return { exitCode: 0, committed: false, purgeFailures: [] }
  }

  await client.$transaction(async (tx) => {
    await tx.securityEvent.deleteMany({
      where: { subjectVerificationId: { in: plan.verificationIds } },
    })
    await tx.providerIdentityVerification.deleteMany({
      where: { id: { in: plan.verificationIds } },
    })

    for (const row of plan.targetRows) {
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'admin',
          action: 'provider_identity_verification.cleanup_delete',
          entityType: 'ProviderIdentityVerification',
          entityId: row.id,
          before: row,
          after: {
            providerId: plan.providerId,
            keptStatus: plan.keepStatus,
            deletedVerificationIds: plan.verificationIds,
            storagePurgeBlobKeys: plan.blobKeys,
            cleanupCommittedAt: (input.now ?? new Date()).toISOString(),
          },
          reason: 'One-off cleanup of duplicate provider identity verification rows after fail-safe rollout.',
        },
      })
    }
  })

  const purgeFailures: ExecuteCleanupResult['purgeFailures'] = []
  for (const blobKey of plan.blobKeys) {
    const result = await deleteBlob(blobKey)
    if (!result.ok) {
      purgeFailures.push({
        blobKey,
        backend: result.backend,
        error: result.error ?? 'unknown storage deletion failure',
      })
    }
  }

  return {
    exitCode: purgeFailures.length > 0 ? 2 : 0,
    committed: true,
    purgeFailures,
  }
}

function readArgValue(args: string[], flag: string): string | null {
  const prefix = `${flag}=`
  const inline = args.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = args.indexOf(flag)
  if (index === -1) return null
  return args[index + 1] ?? null
}

function requireArg(args: string[], flag: string): string {
  const value = readArgValue(args, flag)?.trim()
  if (!value) {
    throw new Error(`Missing required ${flag}`)
  }
  return value
}

async function main() {
  const args = process.argv.slice(2)
  const providerId = requireArg(args, '--provider-id')
  const adminId = requireArg(args, '--admin-id')
  const keepStatus = requireArg(args, '--keep-status')
  if (keepStatus !== 'PASSED') {
    throw new Error('--keep-status must be PASSED')
  }
  const confirm = args.includes('--confirm')

  const plan = await planCleanup({ providerId, keepStatus })
  console.log(JSON.stringify({
    providerId,
    keepStatus,
    confirm,
    targetCount: plan.verificationIds.length,
    verificationIds: plan.verificationIds,
    blobCount: plan.blobKeys.length,
    blockingSecurityEvents: plan.blockingSecurityEvents,
  }, null, 2))

  const result = await executeCleanupPlan({
    plan,
    adminId,
    confirm,
    client: db,
    deleteBlob: deleteIdentityDocumentByBlobKey,
  })

  if (result.purgeFailures.length > 0) {
    const filename = `purge-failures-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(filename, `${JSON.stringify(result.purgeFailures, null, 2)}\n`)
    console.error(`Storage purge failures written to ${filename}`)
  }

  await db.$disconnect()
  process.exit(result.exitCode)
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    await db.$disconnect()
    process.exit(1)
  })
}
