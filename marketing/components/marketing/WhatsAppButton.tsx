"use client";

import Link from "next/link";
import { siteConfig } from "@/lib/metadata";
import { analytics } from "@/lib/analytics";

interface WhatsAppButtonProps {
  compact?: boolean;
  source?: string;
}

export function WhatsAppButton({ compact = false, source = "unknown" }: WhatsAppButtonProps) {
  // Strip all non-digit characters from the number for the wa.me URL
  const number = siteConfig.whatsappNumber.replace(/\D/g, "");
  const message = encodeURIComponent(
    `Hi, I'd like to know more about ${siteConfig.name}`
  );
  const href = `https://wa.me/${number}?text=${message}`;

  const handleClick = () => analytics.whatsappClick(source);

  if (compact) {
    return (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-green-600 hover:text-green-500 dark:text-green-400 font-medium underline-offset-2 hover:underline"
        onClick={handleClick}
      >
        WhatsApp
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
      <span aria-hidden="true">💬</span> Chat on WhatsApp
    </Link>
  );
}
