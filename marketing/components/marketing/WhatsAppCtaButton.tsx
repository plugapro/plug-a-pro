"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import {
  buildWhatsAppLink,
  whatsappMessages,
  type WhatsAppAudience,
} from "@/lib/whatsapp";

interface WhatsAppCtaButtonProps {
  audience: WhatsAppAudience;
  label: string;
  source: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  className?: string;
}

export function WhatsAppCtaButton({
  audience,
  label,
  source,
  variant = "default",
  size = "default",
  className,
}: WhatsAppCtaButtonProps) {
  return (
    <Button
      nativeButton={false}
      render={
        <Link
          href={buildWhatsAppLink(whatsappMessages[audience])}
          target="_blank"
          rel="noopener noreferrer"
        />
      }
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        analytics.whatsappClick(source);
        analytics.ctaClick(label, source, audience);
      }}
    >
      {label}
    </Button>
  );
}
