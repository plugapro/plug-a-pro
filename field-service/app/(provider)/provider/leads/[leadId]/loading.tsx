export default function LeadDetailLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6 pb-28">
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-7 w-4/5 rounded bg-muted" />
      </div>

      <div className="rounded-xl border bg-card">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="border-b px-4 py-4 last:border-b-0">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-2 h-5 w-3/4 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto h-11 max-w-lg rounded bg-muted" />
      </div>
    </div>
  )
}
