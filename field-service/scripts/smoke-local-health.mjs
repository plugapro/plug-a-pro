const port = process.env.PORT ?? '3000'
const baseUrl = (process.env.LOCAL_SMOKE_BASE_URL ?? process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, '')
const healthUrl = `${baseUrl}/api/health`

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), Number(process.env.LOCAL_SMOKE_TIMEOUT_MS ?? 10_000))

try {
  const response = await fetch(healthUrl, { signal: controller.signal })
  const body = await response.json().catch(() => null)

  if (!response.ok || body?.status !== 'ok') {
    console.error('[smoke-local-health] health probe failed', {
      baseUrl,
      status: response.status,
      healthStatus: body?.status ?? 'unknown',
      db: body?.db ?? 'unknown',
      whatsapp: body?.whatsapp ?? 'unknown',
      payments: body?.payments ?? 'unknown',
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
