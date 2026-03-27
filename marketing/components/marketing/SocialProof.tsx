const TRUST_SIGNALS = [
  {
    icon: "🔒",
    title: "Mediated platform",
    description: "Customer and technician contact details are never shared. Plug-A-Pro mediates every interaction.",
  },
  {
    icon: "📲",
    title: "No app download",
    description: "Customers book entirely via WhatsApp. Nothing to install, no account to create.",
  },
  {
    icon: "🇿🇦",
    title: "Built for South Africa",
    description: "ZAR payments, +27 numbers, Peach Payments integration, and en_ZA language support.",
  },
  {
    icon: "🔁",
    title: "End-to-end lifecycle",
    description: "One platform from booking to invoice. No patchwork of tools, no manual handoffs.",
  },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4 border-t border-border/40 bg-muted/30">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {TRUST_SIGNALS.map((signal) => (
            <div key={signal.title} className="text-center space-y-2">
              <span className="text-2xl" aria-hidden="true">{signal.icon}</span>
              <h3 className="font-semibold text-sm">{signal.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{signal.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
