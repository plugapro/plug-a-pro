"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";

interface WebCtaButtonProps {
  href: string;
  label: string;
  source: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  className?: string;
}

export function WebCtaButton({
  href,
  label,
  source,
  variant = "default",
  size = "default",
  className,
}: WebCtaButtonProps) {
  return (
    <Button
      nativeButton={false}
      render={<Link href={href} />}
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        analytics.ctaClick(label, source, "customer");
      }}
    >
      {label}
    </Button>
  );
}
