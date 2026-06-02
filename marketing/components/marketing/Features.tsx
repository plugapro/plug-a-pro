import { homepageFeatures } from "@/content/marketing/homepage";

export function Features() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          Everything that makes the match work
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          From job description to completion, the platform handles matching, communication, written quotes, job records and support.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {homepageFeatures.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="space-y-3">
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
