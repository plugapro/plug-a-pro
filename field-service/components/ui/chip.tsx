import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const chipVariants = cva(
  [
    "inline-flex shrink-0 items-center gap-[6px]",
    "h-8 px-3 rounded-full",
    "text-[13px] font-semibold leading-none tracking-[-0.01em]",
    "transition-[background-color,color] duration-150",
    "select-none whitespace-nowrap",
  ].join(" "),
  {
    variants: {
      tone: {
        neutral:  "bg-[var(--card-alt)] text-[var(--ink)]",
        success:  "bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]",
        warn:     "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]",
        danger:   "bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]",
        brand:    "brand-gradient-soft text-[var(--brand-purple)]",
        whatsapp: "bg-[rgba(37,211,102,0.12)] text-[var(--whatsapp-dark,#1FAD52)]",
      },
      active: {
        true:  "",
        false: "",
      },
    },
    compoundVariants: [
      {
        tone: "neutral",
        active: true,
        className: "bg-[var(--ink)] text-[var(--card)]",
      },
    ],
    defaultVariants: {
      tone:   "neutral",
      active: false,
    },
  }
)

export interface ChipProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof chipVariants> {
  icon?: React.ReactNode
}

function Chip({ className, tone, active, icon, children, onClick, ...props }: ChipProps) {
  return (
    <button
      type="button"
      data-slot="chip"
      onClick={onClick}
      className={cn(
        chipVariants({ tone, active }),
        onClick ? "cursor-pointer" : "cursor-default",
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}

export { Chip, chipVariants }
