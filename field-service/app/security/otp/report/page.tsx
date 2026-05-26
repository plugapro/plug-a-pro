import { ReportClient } from './report-client'

type ReportSearchParams = {
  token?: string | string[]
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function OtpReportPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams>
}) {
  const params = await searchParams
  const token = firstParam(params.token)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <section className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium text-[var(--brand-purple)]">Plug A Pro security</p>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">
            Verification attempt blocked
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Your Plug A Pro account is protected. If you are trying to sign in,
            please start again from the app.
          </p>
        </div>

        <ReportClient token={token} />
      </section>
    </main>
  )
}
