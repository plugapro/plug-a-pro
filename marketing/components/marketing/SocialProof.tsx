const TESTIMONIALS = [
  {
    quote:
      "Our plumbing team used to take 30+ minutes to dispatch a callout. With Plug-A-Pro it's one tap and the technician is on his way.",
    author: "Ryan M.",
    role: "Operations Manager, Plumbing Business",
  },
  {
    quote:
      "Customers stopped calling to ask where the technician is. They get WhatsApp updates at every step — it's changed expectations completely.",
    author: "Sipho K.",
    role: "Owner, Home Maintenance Business",
  },
  {
    quote:
      "The before/after photos and extra work approval have basically eliminated invoice disputes. We have proof for everything now.",
    author: "Nadia P.",
    role: "Admin Manager, Electrical Contractor",
  },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">What our customers say</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div key={t.author} className="rounded-xl border border-border p-6 space-y-4">
              <p className="text-muted-foreground italic">&ldquo;{t.quote}&rdquo;</p>
              <div>
                <p className="font-semibold text-sm">{t.author}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
