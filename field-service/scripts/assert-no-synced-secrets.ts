import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type SyncedEnvFileFinding = {
  relativePath: string
}

export type ServiceRoleKeyFinding = {
  relativePath: string
  keyName: string
}

export type ServiceRoleSecretValueFinding = {
  relativePath: string
  tokenType: string
}

export type ScanResult = {
  ok: boolean
  root: string
  syncedEnvFiles: SyncedEnvFileFinding[]
  serviceRoleKeys: ServiceRoleKeyFinding[]
  serviceRoleSecretValues: ServiceRoleSecretValueFinding[]
}

type CliOptions = {
  cwd?: string
  stdout?: (message: string) => void
  stderr?: (message: string) => void
}

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
])
const MAX_SCANNED_FILE_BYTES = 1_000_000
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

function toPosixRelative(root: string, filePath: string) {
  const relativePath = path.relative(root, filePath) || path.basename(filePath)
  return relativePath.split(path.sep).join('/')
}

function isExampleFile(fileName: string) {
  return fileName.endsWith('.example')
}

function isEnvFile(fileName: string) {
  return fileName.startsWith('.env') && !isExampleFile(fileName)
}

function isSyncedEnvFile(relativePath: string) {
  const parts = relativePath.split('/')
  const fileName = parts.at(-1) ?? ''
  const parentName = parts.at(-2) ?? ''

  if (!isEnvFile(fileName)) return false
  if (parentName === '.vercel') return true
  if (fileName === '.env') return true
  if (fileName.endsWith('.local')) return true
  return fileName.startsWith('.env.production')
}

function isServiceRoleKeyName(keyName: string) {
  return /SERVICE[_-]?ROLE/i.test(keyName)
}

function parseEnvKeyNames(content: string) {
  const keyNames: string[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (match?.[1]) keyNames.push(match[1])
  }

  return keyNames
}

function decodeBase64UrlJson(segment: string): unknown {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function containsServiceRoleJwt(content: string) {
  for (const match of content.matchAll(JWT_PATTERN)) {
    const token = match[0]
    const [, payload] = token.split('.')
    const decoded = payload ? decodeBase64UrlJson(payload) : null
    if (
      decoded &&
      typeof decoded === 'object' &&
      'role' in decoded &&
      (decoded as { role?: unknown }).role === 'service_role'
    ) {
      return true
    }
  }
  return false
}

function readSmallTextFile(filePath: string) {
  try {
    if (statSync(filePath).size > MAX_SCANNED_FILE_BYTES) return null
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

function scanFile(root: string, filePath: string, result: ScanResult) {
  const relativePath = toPosixRelative(root, filePath)
  const fileName = path.basename(filePath)

  if (isSyncedEnvFile(relativePath)) {
    result.syncedEnvFiles.push({ relativePath })
  }

  const content = readSmallTextFile(filePath)
  if (content && containsServiceRoleJwt(content)) {
    result.serviceRoleSecretValues.push({ relativePath, tokenType: 'supabase_service_role_jwt' })
  }

  if (!isEnvFile(fileName) || !content) return
  for (const keyName of parseEnvKeyNames(content)) {
    if (isServiceRoleKeyName(keyName)) {
      result.serviceRoleKeys.push({ relativePath, keyName })
    }
  }
}

function scanDirectory(root: string, directory: string, result: ScanResult) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => {
    return a.name.localeCompare(b.name)
  })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        scanDirectory(root, entryPath, result)
      }
      continue
    }

    if (entry.isFile()) {
      scanFile(root, entryPath, result)
    }
  }
}

export function scanWorkspace(workspaceRoot: string): ScanResult {
  const root = path.resolve(workspaceRoot)
  const result: ScanResult = {
    ok: true,
    root,
    syncedEnvFiles: [],
    serviceRoleKeys: [],
    serviceRoleSecretValues: [],
  }

  if (!existsSync(root)) {
    throw new Error(`Workspace root does not exist: ${root}`)
  }

  scanDirectory(root, root, result)
  result.ok =
    result.syncedEnvFiles.length === 0 &&
    result.serviceRoleKeys.length === 0 &&
    result.serviceRoleSecretValues.length === 0
  return result
}

export function buildReport(result: ScanResult) {
  if (result.ok) {
    return `Secret hygiene check passed for ${result.root}. No synced env files, service-role-shaped keys, or service-role token values were found.`
  }

  const lines = [
    `Secret hygiene check failed for ${result.root}.`,
    '',
  ]

  if (result.syncedEnvFiles.length > 0) {
    lines.push('Synced env files found:')
    for (const finding of result.syncedEnvFiles) {
      lines.push(`- ${finding.relativePath}`)
    }
    lines.push('')
  }

  if (result.serviceRoleKeys.length > 0) {
    lines.push('Service-role-shaped key names found in non-example env files:')
    for (const finding of result.serviceRoleKeys) {
      lines.push(`- ${finding.relativePath}: ${finding.keyName}`)
    }
    lines.push('')
  }

  if (result.serviceRoleSecretValues.length > 0) {
    lines.push('Service-role token values found outside managed secret storage:')
    for (const finding of result.serviceRoleSecretValues) {
      lines.push(`- ${finding.relativePath}: ${finding.tokenType}`)
    }
    lines.push('')
  }

  lines.push('Remediation guidance:')
  lines.push('- Do not delete or rotate real secrets from this script; rotation is human-approved ops work.')
  lines.push('- Use Dropbox ignore only as temporary local containment; CI still requires no real env files under the repo.')
  lines.push('- Prefer moving the working copy out of Dropbox sync and keep only *.example files in synced folders.')

  return lines.join('\n')
}

export function resolveWorkspaceRoot(cwd = process.cwd()) {
  const resolvedCwd = path.resolve(cwd)
  return path.basename(resolvedCwd) === 'field-service'
    ? path.dirname(resolvedCwd)
    : resolvedCwd
}

export function runCli(argv = process.argv.slice(2), options: CliOptions = {}) {
  const stdout = options.stdout ?? console.log
  const stderr = options.stderr ?? console.error
  const rootFlagIndex = argv.indexOf('--root')
  const explicitRoot = rootFlagIndex >= 0 ? argv[rootFlagIndex + 1] : undefined
  const workspaceRoot = explicitRoot ? path.resolve(explicitRoot) : resolveWorkspaceRoot(options.cwd)
  const result = scanWorkspace(workspaceRoot)
  const report = buildReport(result)

  if (result.ok) {
    stdout(report)
    return 0
  }

  stderr(report)
  return 1
}

const currentFilePath = fileURLToPath(import.meta.url)
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (currentFilePath === invokedFilePath) {
  process.exitCode = runCli()
}
