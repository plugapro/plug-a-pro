export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

export default async function AdminDispatchRedirectPage() {
  redirect('/admin/matches')
}
