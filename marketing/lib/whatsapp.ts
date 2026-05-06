import { siteConfig } from "@/lib/metadata";

export type WhatsAppAudience = "customer" | "worker" | "provider";

export const whatsappNumberDigits = siteConfig.whatsappNumber.replace(/\D/g, "");
export const whatsappNumberDisplay = "+27 69 355 2447";

export const whatsappMessages: Record<WhatsAppAudience, string> = {
  customer: "Hi Plug A Pro, I need help with a small job.",
  worker: "Hi Plug A Pro, I’d like to register as a service provider.",
  provider: "Hi Plug A Pro, I’d like to join as a service provider or partner.",
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
    description: "Tell us what needs fixing, installing, or finishing and we’ll start on WhatsApp.",
  },
  {
    audience: "worker",
    label: "I want to offer my services",
    message: whatsappMessages.worker,
    description: "Tell us your trade, which areas you cover, and we’ll get the conversation started.",
  },
  {
    audience: "provider",
    label: "I want to join as a service provider",
    message: whatsappMessages.provider,
    description: "Start the onboarding conversation on WhatsApp if you want to join as a provider or partner.",
  },
];
