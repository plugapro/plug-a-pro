import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptPath = path.resolve(__dirname, '../../scripts/verify-rls-enabled.mjs')

type RlsScriptModule = {
  loadLocalEnvFiles(input: {
    cwd: string
    env: Record<string, string>
    exists(file: string): boolean
    readFile(file: string): string
  }): void
  parseEnvLine(line: string): { key: string; value: string } | null
}

async function importRlsScript() {
  return await import(pathToFileURL(scriptPath).href) as RlsScriptModule
}

describe('RLS live-check env loading', () => {
  it('keeps the env loader importable without opening a Prisma connection', () => {
    const source = readFileSync(scriptPath, 'utf8')

    expect(source).toContain('export function loadLocalEnvFiles')
  })

  it('loads .env then .env.local without overriding inherited CI secrets', async () => {
    const { loadLocalEnvFiles } = await importRlsScript()
    const cwd = '/field-service'
    const files = new Map([
      [
        path.resolve(cwd, '.env'),
        [
          'DATABASE_URL=postgres://from-dotenv',
          'SHARED=from-env',
          'QUOTED="quoted value"',
          "export EXPORTED='from export'",
          'INLINE=plain value # local comment',
          'HASH_URL=postgres://user:p%23ss@db.example/plugapro',
        ].join('\n'),
      ],
      [
        path.resolve(cwd, '.env.local'),
        [
          'SHARED=from-local',
          'LOCAL_ONLY=yes',
        ].join('\n'),
      ],
    ])
    const env: Record<string, string> = {
      DATABASE_URL: 'postgres://ci-secret',
    }

    loadLocalEnvFiles({
      cwd,
      env,
      exists: (file) => files.has(file),
      readFile: (file) => files.get(file) ?? '',
    })

    expect(env).toMatchObject({
      DATABASE_URL: 'postgres://ci-secret',
      SHARED: 'from-local',
      QUOTED: 'quoted value',
      EXPORTED: 'from export',
      INLINE: 'plain value',
      HASH_URL: 'postgres://user:p%23ss@db.example/plugapro',
      LOCAL_ONLY: 'yes',
    })
  })

  it('ignores comments and malformed env lines', async () => {
    const { parseEnvLine } = await importRlsScript()

    expect(parseEnvLine('# comment')).toBeNull()
    expect(parseEnvLine('not valid')).toBeNull()
    expect(parseEnvLine('VALID=value')).toEqual({ key: 'VALID', value: 'value' })
  })
})
