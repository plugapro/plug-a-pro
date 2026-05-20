import { redirect } from 'next/navigation'

export default async function ShortHandoffAliasPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  redirect(`/client/handoff/${encodeURIComponent(token)}`)
}

