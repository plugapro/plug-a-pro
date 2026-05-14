import * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  raised = false,
  ...props
}: React.ComponentProps<"div"> & { raised?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-6 rounded-[24px] bg-card py-5 text-[var(--ink)]",
        "transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
        raised
          ? "shadow-[var(--shadow-float)]"
          : "shadow-[inset_0_0_0_1px_var(--border)]",
        "data-[interactive=true]:cursor-pointer",
        "data-[interactive=true]:hover:-translate-y-0.5 data-[interactive=true]:hover:shadow-[var(--shadow-float)]",
        "data-[interactive=true]:active:translate-y-px data-[interactive=true]:active:scale-[0.985]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-5",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-5 [.border-t]:pt-5", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
