import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function LivenessCompletePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8">
      <div className="rounded-lg border bg-card p-4">
        <h1 className="text-xl font-semibold">We are checking your face-match</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can refresh your verification page in a moment. We will also message you on WhatsApp when the result is ready.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          href={`/provider/verify/${encodeURIComponent(token)}`}
        >
          Refresh status
        </Link>
      </div>
    </main>
  )
}
