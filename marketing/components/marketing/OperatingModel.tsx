export function OperatingModel() {
  return (
    <section
      className="py-20 md:py-24 px-4 border-t border-border/40 bg-muted/50"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How the platform works
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            WhatsApp is the front door. The app is the engine.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Customers and workers both operate through the channels they already use. No friction, no app store.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Customers */}
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">🏠</span>
              <div>
                <h3 className="font-bold text-lg">For customers</h3>
                <p className="text-xs text-muted-foreground">Request, approve, and track</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Describe your job on WhatsApp in under 3 minutes",
                "Receive a notification when a worker is matched",
                "View the worker's profile and rating before accepting",
                "Get the quote in writing. Approve before work starts.",
                "Track live status: on the way, arrived, in progress",
                "Pay after the job. Leave a review. Done.",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span
                    className="mt-1 size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Workers */}
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">🔧</span>
              <div>
                <h3 className="font-bold text-lg">For workers</h3>
                <p className="text-xs text-muted-foreground">Accept leads, quote, earn</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Register via WhatsApp. No paperwork or app store needed.",
                "Set your skills, areas, and availability once",
                "Receive matched leads on WhatsApp. Accept or decline.",
                "Submit structured quotes with photos directly from the app",
                "Update job status from your phone as you work",
                "Build your rating with every completed job",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span
                    className="mt-1 size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-green-wa)" }}
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Both sides can also use the app for a richer view: quotes, photos, job history, and profile management.
        </p>
      </div>
    </section>
  );
}
