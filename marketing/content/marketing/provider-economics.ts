export type ProviderEconomicsPoint = {
  title: string;
  body: string;
};

export const providerEconomicsContent = {
  title: "Provider economics are visible before lead acceptance",
  intro:
    "Providers see how credits work before they unlock customer details, so participation stays clear and traceable.",
  points: [
    {
      title: "Preview first",
      body: "A lead preview shows the job type and area before credits are used.",
    },
    {
      title: "Credits unlock details",
      body: "Credits are used only when the provider unlocks and accepts an eligible customer-selected opportunity.",
    },
    {
      title: "Wallet record",
      body: "Top-ups, deductions, reversals and support adjustments stay in the provider wallet history.",
    },
    {
      title: "Promo credits stay separate",
      body: "Starter, voucher and goodwill credits are recorded separately from purchased credits.",
    },
  ] satisfies ProviderEconomicsPoint[],
};
