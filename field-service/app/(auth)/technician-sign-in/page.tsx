import { redirect } from 'next/navigation'
import { buildLegacyAuthRedirectPath, type LegacyAuthSearchParams } from '@/lib/legacy-auth-redirect'

export default async function TechnicianSignInRedirect({
  searchParams,
}: {
  searchParams: Promise<LegacyAuthSearchParams>
}) {
  const params = await searchParams
  redirect(buildLegacyAuthRedirectPath('/provider-sign-in', params))
}
