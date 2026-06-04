import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { getProviderOnboardingRecoveryDashboardData } from '@/lib/provider-onboarding-recovery'

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function parseDateParam(value: string | null, fallback: Date) {
  if (!value) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdminApi()
  if (unauthorized) return unauthorized

  const from = parseDateParam(request.nextUrl.searchParams.get('from'), startOfToday())
  const to = parseDateParam(request.nextUrl.searchParams.get('to'), new Date())
  const { report } = await getProviderOnboardingRecoveryDashboardData({ from, to })

  return NextResponse.json(report, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  })
}
