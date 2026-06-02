import type { ServiceScopeItem, ServiceScopeStatus } from "@/content/services/service-scope";
import { serviceScopeMatrix } from "@/content/services/service-scope";

function normalizeServiceInput(input: string): string {
  return input.trim().toLowerCase();
}

export function resolveServiceScopeStatus(input: string): ServiceScopeStatus {
  const normalized = normalizeServiceInput(input);
  const direct = serviceScopeMatrix.find((service) => service.slug === normalized);

  if (direct) return direct.status;

  const aliasMatch = serviceScopeMatrix.find((service) =>
    service.aliases.some((alias) => normalized.includes(alias)),
  );

  return aliasMatch?.status ?? "AMBER";
}

export function canRequestServiceInMvp(slug: string): boolean {
  const service = serviceScopeMatrix.find((item) => item.slug === slug);

  return Boolean(service && service.status !== "RED");
}

export function buildWhatsAppServiceMessage(service?: ServiceScopeItem): string {
  if (!service) {
    return "Hi Plug A Pro, I need help with a small job.";
  }

  if (service.status === "RED") {
    return `Hi Plug A Pro, I need advice about ${service.shortName}. I understand this may not be in the MVP scope.`;
  }

  return `Hi Plug A Pro, I need help with a small job: ${service.shortName}. Please help me describe it and get a written quote.`;
}
