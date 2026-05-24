import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildReport, scanWorkspace } from '../../scripts/assert-no-synced-secrets'

const createdRoots: string[] = []

function createWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'plugapro-secret-hygiene-'))
  createdRoots.push(root)
  return root
}

function writeWorkspaceFile(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function fakeServiceRoleJwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', iss: 'supabase' })}.signaturepart1234567890`
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('assert-no-synced-secrets', () => {
  it('flags synced env files under the workspace and ignores example files', () => {
    const root = createWorkspace()
    writeWorkspaceFile(root, '.env', 'DATABASE_URL=postgres://local\n')
    writeWorkspaceFile(root, 'field-service/.env.local', 'NEXT_PUBLIC_APP_URL=http://localhost:3000\n')
    writeWorkspaceFile(root, '.vercel/.env.production.local', 'DATABASE_URL=postgres://vercel\n')
    writeWorkspaceFile(root, 'field-service/.env.production.backup', 'DATABASE_URL=postgres://backup\n')
    writeWorkspaceFile(root, 'field-service/.env.production.local.example', 'DATABASE_URL=example\n')

    const result = scanWorkspace(root)

    expect(result.ok).toBe(false)
    expect(result.syncedEnvFiles.map((finding) => finding.relativePath)).toEqual([
      '.env',
      '.vercel/.env.production.local',
      'field-service/.env.local',
      'field-service/.env.production.backup',
    ])
  })

  it('flags service-role-shaped key names in non-example env files without exposing values', () => {
    const root = createWorkspace()
    writeWorkspaceFile(
      root,
      'field-service/.env.development',
      [
        'SUPABASE_SERVICE_ROLE_KEY=sb_secret_value_that_must_not_print',
        'export INTERNAL_SERVICE_ROLE_SECRET="another_secret_value_that_must_not_print"',
        'NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co',
      ].join('\n'),
    )

    const result = scanWorkspace(root)
    const report = buildReport(result)

    expect(result.ok).toBe(false)
    expect(result.serviceRoleKeys).toEqual([
      { relativePath: 'field-service/.env.development', keyName: 'SUPABASE_SERVICE_ROLE_KEY' },
      { relativePath: 'field-service/.env.development', keyName: 'INTERNAL_SERVICE_ROLE_SECRET' },
    ])
    expect(report).toContain('field-service/.env.development')
    expect(report).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(report).toContain('INTERNAL_SERVICE_ROLE_SECRET')
    expect(report).not.toContain('sb_secret_value_that_must_not_print')
    expect(report).not.toContain('another_secret_value_that_must_not_print')
  })

  it('passes when only example env files are present', () => {
    const root = createWorkspace()
    writeWorkspaceFile(root, '.env.example', 'SUPABASE_SERVICE_ROLE_KEY=example\n')
    writeWorkspaceFile(root, 'field-service/.env.local.example', 'SERVICE_ROLE_KEY=example\n')
    writeWorkspaceFile(root, '.vercel/.env.production.local.example', 'DATABASE_URL=example\n')

    const result = scanWorkspace(root)

    expect(result.ok).toBe(true)
    expect(result.syncedEnvFiles).toEqual([])
    expect(result.serviceRoleKeys).toEqual([])
    expect(result.serviceRoleSecretValues).toEqual([])
  })

  it('flags service-role token values outside env files without printing the token', () => {
    const root = createWorkspace()
    const token = fakeServiceRoleJwt()
    writeWorkspaceFile(root, 'notes/leaked-token.txt', `token=${token}\n`)

    const result = scanWorkspace(root)
    const report = buildReport(result)

    expect(result.ok).toBe(false)
    expect(result.serviceRoleSecretValues).toEqual([
      { relativePath: 'notes/leaked-token.txt', tokenType: 'supabase_service_role_jwt' },
    ])
    expect(report).toContain('notes/leaked-token.txt')
    expect(report).toContain('supabase_service_role_jwt')
    expect(report).not.toContain(token)
  })

  it('prints Dropbox structural remediation guidance when findings exist', () => {
    const root = createWorkspace()
    writeWorkspaceFile(root, '.env.local', 'DATABASE_URL=postgres://local\n')

    const report = buildReport(scanWorkspace(root))

    expect(report).toContain('Dropbox ignore only as temporary local containment')
    expect(report).toContain('moving the working copy out of Dropbox sync')
  })
})
