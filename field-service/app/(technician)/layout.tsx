// Technician PWA layout
// Mobile-first, persistent session, offline-tolerant
// Auth enforced via proxy.ts — only technician role can access

import { requireTechnician } from '@/lib/auth'
import { siteConfig } from '@/lib/metadata'

export default async function TechnicianLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Auth guard — redirects to sign-in if not technician
  const user = await requireTechnician()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Technician top bar */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-top">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="font-semibold text-sm">{siteConfig.name}</span>
          <span className="text-xs text-muted-foreground">Field App</span>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      {/* Bottom nav for technician */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-bottom">
        <div className="flex h-16 items-center justify-around px-2">
          <NavLink href="/technician" label="Jobs" />
          <NavLink href="/technician/profile" label="Profile" />
        </div>
      </nav>
    </div>
  )
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex flex-col items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <span>{label}</span>
    </a>
  )
}
