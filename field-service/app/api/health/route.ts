import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const timestamp = new Date().toISOString()

  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'ok', timestamp }, { status: 200 })
  } catch {
    return NextResponse.json({ status: 'degraded', db: 'error', timestamp }, { status: 503 })
  }
}
