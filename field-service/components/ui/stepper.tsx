import * as React from "react"

import { cn } from "@/lib/utils"

interface StepperProps extends React.ComponentProps<"div"> {
  total: number
  current: number
}

function Stepper({ total, current, className, ...props }: StepperProps) {
  return (
    <div
      data-slot="stepper"
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={total - 1}
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    >
      {Array.from({ length: total }).map((_, i) => {
        const done   = i < current
        const active = i === current
        return (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-250",
              done || active
                ? "bg-[var(--brand-purple)]"
                : "bg-[var(--border)]",
              active && "opacity-55",
            )}
          />
        )
      })}
    </div>
  )
}

export { Stepper }
