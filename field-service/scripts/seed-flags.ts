/**
 * seed-flags.ts
 *
 * Upserts registered feature flags to their target state.
 * Run once after deploying the FeatureFlag migration:
 *
 *   npx tsx scripts/seed-flags.ts
 *
 * Pass --enable to enable all flags (production rollout):
 *   npx tsx scripts/seed-flags.ts --enable
 *
 * Pass --group=ops-crud --enable to enable only implemented ops/admin CRUD:
 *   npx tsx scripts/seed-flags.ts --group=ops-crud --enable
 *
 * Pass --flag=<key> --enable to enable a single flag:
 *   npx tsx scripts/seed-flags.ts --flag=admin.crud.locations --enable
 */

import { setFlag } from '../lib/flags'
import { db } from '../lib/db'
import {
  listFeatureFlagGroups,
  listRegisteredFeatureFlagKeys,
  resolveFeatureFlagTargets,
} from './feature-flag-groups'

function readArgValue(args: string[], prefix: string) {
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  const args = process.argv.slice(2)
  const targetFlag = readArgValue(args, '--flag=')
  const targetGroup = readArgValue(args, '--group=')
  const enabled = args.includes('--enable')

  let targets: ReturnType<typeof resolveFeatureFlagTargets>
  try {
    targets = resolveFeatureFlagTargets({ flag: targetFlag, group: targetGroup })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(`Known groups:\n${listFeatureFlagGroups().map((group) => `  ${group}`).join('\n')}`)
    console.error(`Known flags:\n${listRegisteredFeatureFlagKeys().map((key) => `  ${key}`).join('\n')}`)
    process.exit(1)
  }

  const scope = targetFlag
    ? `flag ${targetFlag}`
    : targetGroup
      ? `group ${targetGroup}`
      : 'all registered flags'

  console.log(`Seeding ${targets.length} feature flag(s) for ${scope}...`)

  for (const flag of targets) {
    await setFlag(flag.key, { enabled, description: flag.description })
    console.log(`  ${enabled ? 'enabled ' : 'disabled'} ${flag.key}`)
  }

  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
