import { siteConfig } from "@/lib/metadata";

export type WhatsAppAudience = "customer" | "worker" | "provider";

export const whatsappNumberDigits = siteConfig.whatsappNumber.replace(/\D/g, "");
export const whatsappNumberDisplay = "+27 69 355 2447";

export const whatsappMessages: Record<WhatsAppAudience, string> = {
  customer: "Hi ServiceMen, I’m looking for a service provider.",
  worker: "Hi ServiceMen, I’m looking for work opportunities.",
  provider: "Hi ServiceMen, I’d like to join as a service provider.",
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
    label: "I’m looking for work",
    message: whatsappMessages.worker,
    description: "Tell us what jobs you want, where you work, and how to reach you.",
  },
  {
    audience: "provider",
    label: "I want to join as a service provider",
    message: whatsappMessages.provider,
    description: "Start the onboarding conversation on WhatsApp if you want to join as a provider or partner.",
  },
];
