import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Vercel injects these at build time; falls back to local git env if running outside Vercel.
const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT_SHA ??
  null
const COMMIT_REF =
  process.env.VERCEL_GIT_COMMIT_REF ??
  process.env.GIT_COMMIT_REF ??
  null
const BUILT_AT = process.env.VERCEL_DEPLOYMENT_CREATED_AT ?? null

export async function GET() {
  const timestamp = new Date().toISOString()

  const build = {
    commitSha: COMMIT_SHA,
    commitShaShort: COMMIT_SHA ? COMMIT_SHA.slice(0, 7) : null,
    commitRef: COMMIT_REF,
    builtAt: BUILT_AT,
  }

  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'ok', timestamp, build }, { status: 200 })
  } catch {
    return NextResponse.json({ status: 'degraded', db: 'error', timestamp, build }, { status: 503 })
  }
}
