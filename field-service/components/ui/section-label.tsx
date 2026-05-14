import * as React from "react"

import { cn } from "@/lib/utils"

interface SectionLabelProps extends React.ComponentProps<"div"> {
  action?: React.ReactNode
}

function SectionLabel({ children, action, className, ...props }: SectionLabelProps) {
  return (
    <div
      data-slot="section-label"
      className={cn(
        "flex items-baseline justify-between mb-2.5 px-1",
        className
      )}
      {...props}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--ink-mute)] leading-none">
        {children}
      </span>
      {action && (
        <span className="text-[13px] font-semibold text-[var(--brand-purple)] leading-none">
          {action}
        </span>
      )}
    </div>
  )
}

export { SectionLabel }
