import * as React from "react"

import { cn } from "@/lib/utils"

export type StatusTone = "success" | "warn" | "danger" | "idle"

const toneHalo: Record<StatusTone, string> = {
  success: "0 0 0 4px rgba(15,157,88,0.13)",
  warn:    "0 0 0 4px rgba(230,153,0,0.13)",
  danger:  "0 0 0 4px rgba(229,72,77,0.13)",
  idle:    "0 0 0 4px rgba(156,160,168,0.13)",
}

const toneBg: Record<StatusTone, string> = {
  success: "var(--success)",
  warn:    "var(--warning)",
  danger:  "var(--danger)",
  idle:    "var(--ink-soft)",
}

interface StatusDotProps extends React.ComponentProps<"span"> {
  tone?: StatusTone
  size?: number
}

function StatusDot({ tone = "success", size = 8, className, style, ...props }: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width:  size,
        height: size,
        background: toneBg[tone],
        boxShadow:  toneHalo[tone],
        ...style,
      }}
      {...props}
    />
  )
}

export { StatusDot }
