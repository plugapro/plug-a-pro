'use client'

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { AppLogo } from "@/components/shared/app-logo"
import { Wordmark } from "@/components/shared/wordmark"
import { cn } from "@/lib/utils"

interface AuthShellProps {
  children: React.ReactNode
  eyebrow?: string
  title?: string
  subtitle?: React.ReactNode
  backHref?: string
  footer?: React.ReactNode
  dense?: boolean
  className?: string
}

function AuthShell({
  children,
  eyebrow,
  title,
  subtitle,
  backHref,
  footer,
  dense = false,
  className,
}: AuthShellProps) {
  const router = useRouter()

  function handleBack() {
    if (!backHref) return
    router.push(backHref)
  }

  return (
    <div className={cn("relative flex flex-col min-h-dvh bg-background overflow-x-hidden", className)}>
      {/* gradient halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -left-20 -right-20 h-80"
        style={{
          background: "radial-gradient(60% 80% at 50% 0%, rgba(139,63,232,0.15), transparent 70%)",
        }}
      />

      {/* safe-area top gap */}
      <div className="h-[max(env(safe-area-inset-top,0px),20px)] shrink-0" />

      {/* header bar */}
      <header className="relative z-10 flex items-center justify-between px-4 py-2">
        {backHref ? (
          <button
            onClick={handleBack}
            type="button"
            aria-label="Go back"
            className={cn(
              "flex items-center justify-center w-[38px] h-[38px] rounded-[12px]",
              "bg-card shadow-[inset_0_0_0_1px_var(--border)] text-[var(--ink)]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]",
              "transition-[box-shadow,transform] active:scale-95",
            )}
          >
            <ArrowLeft size={18} />
          </button>
        ) : (
          <div className="w-[38px]" aria-hidden />
        )}

        <div className="flex items-center gap-2">
          <AppLogo href="/" compact className="h-[26px]" priority />
          <Wordmark size={12} />
        </div>

        <div className="w-[38px]" aria-hidden />
      </header>

      {/* scrollable body */}
      <div className={cn("flex-1 overflow-y-auto relative z-[1] px-[22px] pb-8", dense ? "pt-5" : "pt-8")}>
        {eyebrow && (
          <p className="text-[11px] font-bold tracking-[0.085em] uppercase text-[var(--brand-purple)] text-center mb-2">
            {eyebrow}
          </p>
        )}
        {title && (
          <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-[var(--ink)] text-center mb-2 [text-wrap:balance]">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="text-[14.5px] leading-relaxed text-[var(--ink-mute)] text-center mb-7 [text-wrap:pretty]">
            {subtitle}
          </p>
        )}
        {children}
      </div>

      {footer}
    </div>
  )
}

export { AuthShell }
