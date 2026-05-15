import * as React from "react"

import { cn } from "@/lib/utils"

interface WordmarkProps {
  size?: number
  className?: string
}

function Wordmark({ size = 14, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-[0.3em] font-extrabold tracking-[0.025em] text-[var(--ink)]",
        className
      )}
      style={{ fontSize: size }}
      aria-label="Plug A Pro"
    >
      <span className="brand-gradient-text">PLUG</span>
      <span>A</span>
      <span className="brand-gradient-text">PRO</span>
    </span>
  )
}

export { Wordmark }
