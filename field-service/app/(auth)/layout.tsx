import type { ReactNode } from 'react'
import Image from 'next/image'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-12">
      {/* Brand logo */}
      <div className="mb-8">
        <Image
          src="/logo.png"
          alt="Plug-A-Pro"
          width={180}
          height={36}
          className="h-9 w-auto"
          priority
        />
      </div>

      {/* Auth card */}
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur-sm">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-8 text-xs text-zinc-600">
        &copy; {new Date().getFullYear()} Plug-A-Pro. All rights reserved.
      </p>
    </div>
  )
}
