import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: layout + type + motion — no colour here
  [
    "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2",
    "rounded-[16px] text-[15px] font-semibold leading-none whitespace-nowrap",
    "transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-out",
    "outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
    "active:translate-y-px active:scale-[0.985] active:shadow-none",
    "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1",
    "motion-reduce:transform-none motion-reduce:transition-none",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  ].join(" "),
  {
    variants: {
      variant: {
        /* Primary: brand gradient — single primary CTA per screen */
        gradient:
          "brand-gradient text-white " +
          "shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_24px_#8B3FE833,0_2px_6px_#8B3FE822] " +
          "hover:brightness-105",

        /* Default maps to gradient so existing callers get the new look */
        default:
          "brand-gradient text-white " +
          "shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_24px_#8B3FE833,0_2px_6px_#8B3FE822] " +
          "hover:brightness-105",

        /* Secondary: card bg + 1px border */
        secondary:
          "bg-card text-[var(--ink)] " +
          "shadow-[inset_0_0_0_1px_var(--border)] " +
          "hover:bg-[var(--card-alt)]",

        /* Outline: alias for secondary */
        outline:
          "bg-card text-[var(--ink)] " +
          "shadow-[inset_0_0_0_1px_var(--border)] " +
          "hover:bg-[var(--card-alt)]",

        /* Ghost: no bg */
        ghost:
          "bg-transparent text-[var(--ink)] hover:bg-[var(--card-alt)]",

        /* Dark: ink bg, card text */
        dark:
          "bg-[var(--ink)] text-[var(--card)]",

        /* WhatsApp: brand green */
        whatsapp:
          "bg-[#25D366] text-white " +
          "shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_6px_18px_#25D36655] " +
          "hover:brightness-105",

        /* Danger: destructive red */
        danger:
          "bg-[var(--danger)] text-white hover:brightness-105",

        /* Destructive: alias */
        destructive:
          "bg-[var(--danger)] text-white hover:brightness-105",

        /* Tinted: subtle card-alt surface */
        tinted:
          "bg-[var(--card-alt)] text-[var(--ink)] dark:bg-white/6",

        /* Link: text only */
        link:
          "text-[var(--brand-purple)] underline-offset-4 hover:underline",
      },
      size: {
        sm:   "h-10 px-4 text-[14px]",
        default: "h-12 px-[18px]",       /* 48px */
        md:   "h-12 px-[18px]",           /* 48px */
        lg:   "h-[54px] px-[20px] text-[16px]",
        icon: "size-12 px-0",
        "icon-sm": "size-10 px-0",
        "icon-lg": "size-[54px] px-0",
        xs:   "h-8 px-3 text-[13px] rounded-[12px]",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      fullWidth: false,
    },
  }
)

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, fullWidth, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
