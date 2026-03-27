const CAPABILITIES = [
  {
    icon: "💬",
    title: "WhatsApp Booking",
    description:
      "Customers book via a guided WhatsApp menu. No app, no email, no account. Works on any Android with WhatsApp.",
  },
  {
    icon: "📡",
    title: "Smart Dispatch",
    description:
      "Assign jobs from your admin console in one tap. Technicians get WhatsApp notifications instantly with full job details.",
  },
  {
    icon: "📍",
    title: "Live Job Tracking",
    description:
      "Follow every job from ASSIGNED to COMPLETED. Immutable audit trail at every stage — no disputes, no gaps.",
  },
  {
    icon: "🧾",
    title: "Digital Invoicing",
    description:
      "Invoices auto-generated on job completion. PDFs sent to customers via WhatsApp automatically. No manual work.",
  },
  {
    icon: "📱",
    title: "Technician PWA",
    description:
      "A lightweight job app your techs install like a website. No App Store. Works on any Android. Status updates, photos, extra work approval.",
  },
  {
    icon: "🔔",
    title: "Automated Customer Updates",
    description:
      "WhatsApp messages keep customers informed at every stage — technician on the way, arrived, completed. Without you lifting a finger.",
  },
];

export function Features() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Platform capabilities
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            Everything your service business needs
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="rounded-2xl border border-border/40 p-6 space-y-3 hover:shadow-sm transition-shadow"
            >
              <span className="text-3xl" aria-hidden="true">{cap.icon}</span>
              <h3 className="font-semibold">{cap.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
