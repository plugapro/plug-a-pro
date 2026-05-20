'use client'

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

export interface BottomNavItem {
  id: string
  label: string
  icon: React.ReactNode
  href: string
  exact?: boolean
}

interface BottomNavProps {
  items: BottomNavItem[]
  className?: string
}

function BottomNav({ items, className }: BottomNavProps) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        "layer-sticky fixed bottom-0 left-0 right-0",
        "flex justify-around",
        "px-3 pt-2 pb-[calc(28px+env(safe-area-inset-bottom,0px))]",
        "bg-white/85 dark:bg-[rgba(11,11,16,0.85)]",
        "[backdrop-filter:blur(20px)_saturate(180%)] [-webkit-backdrop-filter:blur(20px)_saturate(180%)]",
        "shadow-[inset_0_1px_0_var(--border)]",
        className
      )}
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/")

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-1.5 px-1",
              "text-[11px] font-semibold leading-none tracking-[-0.01em]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)] rounded-lg",
              active ? "text-[var(--brand-purple)]" : "text-[var(--ink-mute)]",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-11 h-7 rounded-[14px]",
                "transition-[background-color] duration-150",
                active ? "brand-gradient-soft" : "bg-transparent",
              )}
            >
              {item.icon}
            </div>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export { BottomNav }
