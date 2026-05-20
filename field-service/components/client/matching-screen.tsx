export function MatchingScreen() {
  return (
    <div className="mx-auto max-w-md px-5 py-10 text-center [animation:pap-fade-in_.2s_ease-out_both]">
      <div className="mx-auto grid h-44 w-44 place-items-center">
        <div className="relative h-28 w-28 rounded-full bg-[var(--tone-brand-bg)]">
          <div className="absolute inset-0 rounded-full border border-[var(--brand-purple)]/30 [animation:pap-radar_1.8s_ease-out_infinite]" />
          <div className="absolute inset-0 rounded-full border border-[var(--brand-purple)]/22 [animation:pap-radar_1.8s_ease-out_.6s_infinite]" />
          <div className="absolute inset-0 rounded-full border border-[var(--brand-purple)]/16 [animation:pap-radar_1.8s_ease-out_1.2s_infinite]" />
          <div className="absolute inset-[30px] rounded-full border border-[var(--brand-pink)]/50 bg-card" />
        </div>
      </div>
      <p className="text-[24px] font-bold tracking-tight">We&apos;re finding the best providers for you</p>
      <p className="mt-2 text-sm text-[var(--ink-mute)]">Matching usually takes 3–5 minutes.</p>
      <div className="mx-auto mt-6 max-w-xs rounded-2xl bg-[rgba(37,211,102,0.08)] px-4 py-3 text-left">
        <p className="text-[13px] font-semibold">Close this if you want</p>
        <p className="text-xs text-[var(--ink-mute)]">We&apos;ll WhatsApp you when providers are ready.</p>
      </div>
    </div>
  )
}
