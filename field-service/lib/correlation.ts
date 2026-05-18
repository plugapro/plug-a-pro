import { headers } from 'next/headers'
import { randomUUID } from 'crypto'

export async function getCorrelationId(): Promise<string> {
  try {
    const headerList = await headers()
    return (
      headerList.get('x-correlation-id') ??
      headerList.get('x-request-id') ??
      randomUUID()
    )
  } catch {
    return randomUUID()
  }
}

export function logWithCorrelation(
  level: 'info' | 'warn' | 'error',
  correlationId: string,
  message: string,
  data?: unknown,
) {
  const entry = {
    timestamp: new Date().toISOString(),
    correlationId,
    level,
    message,
    ...(data ? { data } : {}),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}
