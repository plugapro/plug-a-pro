import { siteConfig } from "@/lib/metadata";

export type WhatsAppAudience = "customer" | "provider";

export const whatsappNumberDigits = siteConfig.whatsappNumber.replace(/\D/g, "");
export const whatsappNumberDisplay = "+27 69 355 2447";

export const whatsappMessages: Record<WhatsAppAudience, string> = {
  customer: "Hi Plug A Pro, I need help with a small job.",
  provider: "Hi Plug A Pro, I’d like to register as a local service provider.",
};

export function buildWhatsAppLink(message?: string) {
  if (!message) {
    return `https://wa.me/${whatsappNumberDigits}`;
  }

  const params = new URLSearchParams({ text: message });
  return `https://wa.me/${whatsappNumberDigits}?${params.toString()}`;
}

export const whatsappAudienceOptions: Array<{
  audience: WhatsAppAudience;
  label: string;
  message: string;
  description: string;
}> = [
  {
    audience: "customer",
    label: "I need a service provider",
    message: whatsappMessages.customer,
    description: "Tell us what needs fixing, installing or finishing and we’ll start on WhatsApp.",
  },
  {
    audience: "provider",
    label: "I want to join as a service provider",
    message: whatsappMessages.provider,
    description: "Tell us your service types, areas and availability so the onboarding conversation starts correctly.",
  },
];
