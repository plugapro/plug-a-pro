import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function valueForComponent(body, component) {
  if (component === 'auth.supabase_env_complete') return body?.auth?.supabase_env_complete
  return body?.[component]
}

function expectedForComponent(component) {
  return component === 'auth.supabase_env_complete' ? true : 'ok'
}

export function evaluateHealth(body, options = {}) {
  const requiredComponents = options.requiredComponents ?? ['db']
  const failures = []

  if (body?.status !== 'ok') {
    failures.push(`status expected ok but received ${body?.status ?? 'unknown'}`)
  }

  for (const component of requiredComponents) {
    const expected = expectedForComponent(component)
    const actual = valueForComponent(body, component)
    if (actual !== expected) {
      failures.push(`${component} expected ${expected} but received ${actual ?? 'unknown'}`)
    }
  }

  if (options.expectedCommitSha) {
    const actualSha = body?.build?.commitSha ?? null
    if (actualSha !== options.expectedCommitSha) {
      failures.push(`build.commitSha expected ${options.expectedCommitSha} but received ${actualSha ?? 'unknown'}`)
    }
  }

  return { ok: failures.length === 0, failures }
}

function parseRequiredComponents() {
  const raw = process.env.LOCAL_SMOKE_REQUIRE_COMPONENTS ?? 'db'
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

async function main() {
  const port = process.env.PORT ?? '3000'
  const baseUrl = (process.env.LOCAL_SMOKE_BASE_URL ?? process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, '')
  const healthUrl = `${baseUrl}/api/health`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LOCAL_SMOKE_TIMEOUT_MS ?? 10_000))

  try {
    const response = await fetch(healthUrl, { signal: controller.signal })
    const body = await response.json().catch(() => null)
    const evaluation = evaluateHealth(body, {
      requiredComponents: parseRequiredComponents(),
      expectedCommitSha: process.env.LOCAL_SMOKE_EXPECT_COMMIT_SHA || undefined,
    })

    if (!response.ok || !evaluation.ok) {
      console.error('[smoke-local-health] health probe failed', {
        baseUrl,
        status: response.status,
        healthStatus: body?.status ?? 'unknown',
        db: body?.db ?? 'unknown',
        whatsapp: body?.whatsapp ?? 'unknown',
        payments: body?.payments ?? 'unknown',
        supabaseEnvComplete: body?.auth?.supabase_env_complete ?? 'unknown',
        commitSha: body?.build?.commitSha ?? 'unknown',
        failures: evaluation.failures,
      })
      process.exit(1)
    }

    console.log('[smoke-local-health] health probe passed', {
      baseUrl,
      status: response.status,
      healthStatus: body.status,
      db: body.db,
      whatsapp: body.whatsapp,
      payments: body.payments,
      supabaseEnvComplete: body?.auth?.supabase_env_complete ?? 'unknown',
      commitSha: body?.build?.commitSha ?? 'unknown',
    })
  } catch (error) {
    console.error('[smoke-local-health] health probe error', {
      baseUrl,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
