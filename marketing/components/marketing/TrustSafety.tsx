import { trustPackItems } from "@/content/marketing/trust";

export function TrustSafety() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Trust & safety
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built to reduce risk with clearer records
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Plug A Pro does not remove every risk, but it does create clearer records, staged contact sharing and better evidence than an informal offline deal.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {trustPackItems.map((point) => {
            const Icon = point.icon;
            return (
              <div
                key={point.title}
                className="rounded-2xl border border-border/40 p-6 space-y-3"
              >
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-semibold text-sm">{point.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {point.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
