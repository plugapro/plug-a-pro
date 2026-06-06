import { getAppUrl } from "@/lib/metadata";

export const PROVIDER_REGISTRATION_PATH = "/provider/register";

export function getProviderRegistrationUrl(): string {
  return new URL(PROVIDER_REGISTRATION_PATH, getAppUrl()).toString();
}
