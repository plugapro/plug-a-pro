const TESTIMONIALS = [
  { quote: "This product changed how our team works.", author: "Alex T.", role: "CTO, Startup" },
  { quote: "We launched in half the time we expected.", author: "Maria S.", role: "Founder" },
  { quote: "The best investment we made this year.", author: "James K.", role: "Product Lead" },
];

export function SocialProof() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">What people are saying</h2>
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
