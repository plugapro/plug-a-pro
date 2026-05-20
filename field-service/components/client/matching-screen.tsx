export function MatchingScreen() {
  return (
    <div className="mx-auto max-w-md px-5 py-10 text-center">
      <div className="mx-auto grid h-40 w-40 place-items-center">
        <div className="relative h-24 w-24 rounded-full border border-[var(--brand-purple)]/40">
          <div className="absolute inset-0 animate-ping rounded-full border border-[var(--brand-purple)]/30" />
          <div className="absolute inset-3 rounded-full border border-[var(--brand-pink)]/40" />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight">Finding providers</p>
      <p className="mt-2 text-sm text-[var(--ink-mute)]">Close this screen. We&apos;ll WhatsApp you when your shortlist is ready.</p>
    </div>
  )
}

