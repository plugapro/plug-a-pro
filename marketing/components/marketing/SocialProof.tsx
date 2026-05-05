const TESTIMONIALS = [
  {
    quote:
      "I had a leaking tap and a dripping shower head. Described both on WhatsApp, got a plumber the next morning. Price was exactly what was quoted — not a cent more.",
    author: "Thandi M.",
    role: "Homeowner, Bryanston",
  },
  {
    quote:
      "I get 3 to 4 jobs a week through the app now. Before this I was just standing outside Builders Warehouse hoping someone would walk past. It's changed everything.",
    author: "Sipho D.",
    role: "Handyman, Johannesburg South",
  },
  {
    quote:
      "I started building a deck but got completely stuck on the concrete footing. Found someone through Plug A Pro who sorted it in two hours. He finished the whole thing the next weekend.",
    author: "Ryan K.",
    role: "DIYer, Centurion",
  },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          From people who&apos;ve used it
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          Customers who got their jobs done. Workers who got steady work.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.author}
              className="rounded-xl border border-border p-6 space-y-4 flex flex-col"
            >
              <p className="text-muted-foreground italic flex-1">
                &ldquo;{t.quote}&rdquo;
              </p>
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
