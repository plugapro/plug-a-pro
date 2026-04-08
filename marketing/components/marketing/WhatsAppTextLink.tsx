"use client";

import { WhatsAppButton } from "./WhatsAppButton";
import type { WhatsAppAudience } from "@/lib/whatsapp";

interface WhatsAppTextLinkProps {
  audience: WhatsAppAudience;
  label: string;
  source: string;
}

export function WhatsAppTextLink({ audience, label, source }: WhatsAppTextLinkProps) {
  return <WhatsAppButton compact audience={audience} label={label} source={source} />;
}
