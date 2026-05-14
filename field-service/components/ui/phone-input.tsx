'use client'

import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface PhoneInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  className?: string
  id?: string
}

function PhoneInput({
  value,
  onChange,
  placeholder = "82 123 4567",
  autoFocus,
  disabled,
  className,
  id,
}: PhoneInputProps) {
  const [focused, setFocused] = React.useState(false)

  return (
    <div
      className={cn(
        "flex items-stretch h-[52px] rounded-[16px] bg-card overflow-hidden",
        "transition-[box-shadow] duration-150",
        focused
          ? "shadow-[inset_0_0_0_1.5px_var(--brand-purple)]"
          : "shadow-[inset_0_0_0_1px_var(--border)]",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      <div
        className="flex items-center gap-1.5 px-3 shrink-0 bg-[var(--card-alt)] border-r border-[var(--border)] text-[var(--ink)] text-[14px] font-semibold"
        aria-label="Country: South Africa +27"
      >
        <span className="text-base leading-none" aria-hidden>🇿🇦</span>
        <span>+27</span>
        <ChevronDown size={14} className="text-[var(--ink-mute)]" aria-hidden />
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d\s]/g, ""))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={13}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "flex-1 min-w-0 h-full px-[14px] border-none outline-none",
          "bg-transparent text-[var(--ink)] text-[15px] font-medium",
          "placeholder:text-[var(--ink-soft)] tracking-[0.012em]",
        )}
      />
    </div>
  )
}

export { PhoneInput }
