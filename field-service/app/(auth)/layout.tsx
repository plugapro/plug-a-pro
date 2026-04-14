import type { ReactNode } from 'react'
import { AppLogo } from '@/components/shared/app-logo'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <AppLogo priority />
        <p className="max-w-sm text-sm text-muted-foreground">
          Trusted field-service operations for customers, technicians, and internal teams.
        </p>
      </div>

      <div className="app-shell-panel w-full max-w-sm rounded-[1.75rem] p-8">
        {children}
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Plug-A-Pro. All rights reserved.
      </p>
    </div>
  )
}
