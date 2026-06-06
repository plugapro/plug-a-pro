'use client'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Please reply on WhatsApp to try again.
      </p>
      <button className="mt-4 underline" onClick={reset}>
        Retry
      </button>
    </main>
  )
}
