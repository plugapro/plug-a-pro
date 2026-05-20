import Link from 'next/link'
import { Home } from 'lucide-react'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <main className="pb-[calc(72px+env(safe-area-inset-bottom,0px))]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-[rgba(246,246,248,0.92)] px-5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] pt-2 backdrop-blur-xl dark:bg-[rgba(11,11,16,0.92)]">
        <div className="mx-auto flex max-w-md justify-center">
          <Link href="/client" className="inline-flex min-w-[84px] flex-col items-center gap-1 text-[11px] font-semibold text-[var(--brand-purple)]">
            <span className="grid h-7 w-11 place-items-center rounded-full bg-[var(--tone-brand-bg)]"><Home size={16} /></span>
            Home
          </Link>
        </div>
      </nav>
    </div>
  )
}

