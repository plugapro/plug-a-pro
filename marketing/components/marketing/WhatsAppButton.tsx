"use client";

import Link from "next/link";
import { analytics } from "@/lib/analytics";
import {
  buildWhatsAppLink,
  whatsappMessages,
  type WhatsAppAudience,
} from "@/lib/whatsapp";

interface WhatsAppButtonProps {
  compact?: boolean;
  source?: string;
  message?: string;
  label?: string;
  audience?: WhatsAppAudience;
}

export function WhatsAppButton({
  compact = false,
  source = "unknown",
  message,
  label = "Chat on WhatsApp",
  audience,
}: WhatsAppButtonProps) {
  const resolvedMessage =
    message ?? (audience ? whatsappMessages[audience] : "Hi ServiceMen, I’d like to chat on WhatsApp.");
  const href = buildWhatsAppLink(resolvedMessage);

  const handleClick = () => {
    analytics.whatsappClick(source);
    if (audience) {
      analytics.ctaClick(label, source, audience);
    }
  };

  if (compact) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-green-600 hover:text-green-500 dark:text-green-400 font-medium underline-offset-2 hover:underline"
        onClick={handleClick}
      >
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-sm text-green-600 hover:text-green-500 dark:text-green-400"
      onClick={handleClick}
    >
      <span aria-hidden="true">💬</span> {label}
    </Link>
  );
}
