import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? process.cwd())
const ignoredDirs = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'node_modules',
  '.pnpm-store',
  'test-results',
  '.worktrees',
])
const blockedEnvFilePattern = /^(?:\.env|\.env\.local|\.env.*\.local|\.env\.production.*|\.env\.vercel\.local)$/
const blockedVercelEnvPattern = /(?:^|[/\\])\.vercel[/\\]\.env/
const jwtPattern = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g
const supabaseSecretKeyPattern = /sb_secret_[a-zA-Z0-9_-]{32,}/
const maxScannedBytes = 1024 * 1024

function toRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function isBlockedEnvFile(filePath) {
  const relative = toRelative(filePath)
  return blockedEnvFilePattern.test(path.basename(filePath)) || blockedVercelEnvPattern.test(relative)
}

function shouldSkipDirectory(name) {
  return ignoredDirs.has(name)
}

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        collectFiles(path.join(dir, entry.name), files)
      }
      continue
    }

    if (entry.isFile()) {
      files.push(path.join(dir, entry.name))
    }
  }

  return files
}

function readSmallTextFile(filePath) {
  const { size } = statSync(filePath)
  if (size > maxScannedBytes) {
    return null
  }

  return readFileSync(filePath, 'utf8')
}

function containsServiceRoleSecret(content) {
  if (supabaseSecretKeyPattern.test(content)) {
    return true
  }

  for (const match of content.matchAll(jwtPattern)) {
    const payload = match[0].split('.')[1]
    try {
      const decoded = Buffer.from(payload, 'base64url').toString('utf8')
      const parsed = JSON.parse(decoded)
      if (parsed?.role === 'service_role') {
        return true
      }
    } catch {
      continue
    }
  }

  return false
}

if (!existsSync(root)) {
  console.error(`Secret hygiene root does not exist: ${root}`)
  process.exit(1)
}

const findings = []

for (const filePath of collectFiles(root)) {
  const relative = toRelative(filePath)

  if (isBlockedEnvFile(filePath)) {
    findings.push({ file: relative, reason: 'blocked env file' })
    continue
  }

  try {
    const content = readSmallTextFile(filePath)
    if (content && containsServiceRoleSecret(content)) {
      findings.push({ file: relative, reason: 'service-role-shaped secret' })
    }
  } catch {
    // Binary or unreadable files are ignored; the guard is aimed at text leaks.
  }
}

if (findings.length > 0) {
  console.error('Secret hygiene violations found:')
  for (const finding of findings) {
    console.error(`- ${finding.file} (${finding.reason})`)
  }
  process.exit(1)
}

console.log('No blocked env files or service-role-shaped secrets found.')
