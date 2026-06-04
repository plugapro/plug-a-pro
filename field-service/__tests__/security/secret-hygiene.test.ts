import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve(__dirname, '../../scripts/secret-hygiene.mjs')

function runSecretGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [scriptPath, root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return { status: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

describe('secret hygiene guard', () => {
  it('flags blocked env files without printing their contents', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pap-secret-hygiene-'))
    const secretValue = 'sb_secret_' + 'a'.repeat(40)
    writeFileSync(path.join(root, '.env.production.local'), `SUPABASE_SERVICE_ROLE_KEY=${secretValue}\n`)
    writeFileSync(path.join(root, '.env.development'), 'SAFE_PLACEHOLDER=value\n')
    writeFileSync(path.join(root, '.env.staging'), 'SAFE_PLACEHOLDER=value\n')
    writeFileSync(path.join(root, '.env.test'), 'SAFE_PLACEHOLDER=value\n')

    const result = runSecretGuard(root)

    expect(result.status).toBe(1)
    expect(result.output).toContain('.env.production.local')
    expect(result.output).toContain('.env.development')
    expect(result.output).toContain('.env.staging')
    expect(result.output).toContain('.env.test')
    expect(result.output).not.toContain(secretValue)
  })

  it('flags service-role-shaped secrets outside env files without printing values', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pap-secret-hygiene-'))
    const serviceRoleSecret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') +
      '.signature'
    mkdirSync(path.join(root, 'notes'))
    writeFileSync(path.join(root, 'notes', 'incident.md'), `rotated token: ${serviceRoleSecret}\n`)

    const result = runSecretGuard(root)

    expect(result.status).toBe(1)
    expect(result.output).toContain('notes/incident.md')
    expect(result.output).not.toContain(serviceRoleSecret)
  })

  it('flags Pay@ credential-shaped values outside env files without printing values', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pap-secret-hygiene-'))
    const payatClientSecret = 'PAYAT_CLIENT_SECRET=' + 'a'.repeat(8) + '-' + 'b'.repeat(4) + '-' + 'c'.repeat(4) + '-' + 'd'.repeat(4) + '-' + 'e'.repeat(12)
    const payatWebhookSecret = 'PAYAT_WEBHOOK_SECRET=' + 'f'.repeat(64)
    mkdirSync(path.join(root, 'notes'))
    writeFileSync(path.join(root, 'notes', 'payat.md'), `${payatClientSecret}\n${payatWebhookSecret}\n`)

    const result = runSecretGuard(root)

    expect(result.status).toBe(1)
    expect(result.output).toContain('notes/payat.md')
    expect(result.output).not.toContain(payatClientSecret)
    expect(result.output).not.toContain(payatWebhookSecret)
  })

  it('allows example files with placeholder service role variable names', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pap-secret-hygiene-'))
    writeFileSync(
      path.join(root, '.env.local.example'),
      'SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n',
    )
    writeFileSync(
      path.join(root, '.env.staging.example'),
      'SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n',
    )

    const result = runSecretGuard(root)

    expect(result.status).toBe(0)
  })

  it.runIf(process.platform === 'darwin')('allows local env files after Dropbox ignore is applied', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pap-secret-hygiene-'))
    const envFile = path.join(root, '.env.local')
    writeFileSync(envFile, 'SAFE_PLACEHOLDER=value\n')
    execFileSync('xattr', ['-w', 'com.dropbox.ignored', '1', envFile])

    const result = runSecretGuard(root)

    expect(result.status).toBe(0)
  })
})
