import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[52px] w-full min-w-0 rounded-[16px] bg-card px-[14px] py-1",
        "text-[15px] font-medium text-[var(--ink)] leading-none",
        "shadow-[inset_0_0_0_1px_var(--border)]",
        "transition-[color,box-shadow,background-color] duration-150 outline-none",
        "placeholder:text-[var(--ink-soft)]",
        "selection:bg-primary selection:text-white",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--ink)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]",
        "aria-invalid:shadow-[inset_0_0_0_1.5px_var(--danger)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
