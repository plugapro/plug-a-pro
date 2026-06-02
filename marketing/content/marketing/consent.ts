export type ConsentPurpose =
  | "WHATSAPP_TRANSACTIONAL_HANDOFF"
  | "RESOURCE_DELIVERY"
  | "PROVIDER_ONBOARDING";

export type ConsentDisclosure = {
  version: string;
  purpose: ConsentPurpose;
  label: string;
  body: string;
};

export const marketingConsentText = {
  whatsappTransactional: {
    version: "2026-06-02.whatsapp-transactional.v1",
    purpose: "WHATSAPP_TRANSACTIONAL_HANDOFF",
    label: "WhatsApp contact consent",
    body:
      "I agree that Plug A Pro may contact me on WhatsApp about this request, registration or resource, including service updates and support messages.",
  },
} as const satisfies Record<string, ConsentDisclosure>;

export function buildMarketingConsentRecord(source: string) {
  const disclosure = marketingConsentText.whatsappTransactional;

  return {
    consent_text: disclosure.body,
    consent_text_version: disclosure.version,
    consent_source: source,
    consent_accepted_at: new Date().toISOString(),
  };
}
