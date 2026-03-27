export function OperatingModel() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How the platform works
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            WhatsApp is the front door. The PWA is the engine room.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Two channels. One platform. No friction for customers, full control for your business.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">💬</span>
              <div>
                <h3 className="font-bold text-lg">WhatsApp Channel</h3>
                <p className="text-xs text-muted-foreground">For customers and technicians</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Customers book, confirm, and pay without leaving WhatsApp",
                "Technicians receive job assignments and status prompts via WhatsApp",
                "Automated notifications sent at every job milestone",
                "Extra work approval sent to customer as a WhatsApp link",
                "Invoice and rating request delivered on completion",
                "Works on any phone with WhatsApp — no app download",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span className="mt-1 size-1.5 rounded-full flex-shrink-0 bg-[var(--accent-green-wa)]" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">📱</span>
              <div>
                <h3 className="font-bold text-lg">PWA — Lightweight App</h3>
                <p className="text-xs text-muted-foreground">For your operations team and technicians</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Technicians install the job app directly from a link — no App Store",
                "Status controls: en route, arrived, started, completed",
                "Before and after photo uploads on every job",
                "Extra work logging with customer approval flow",
                "Customers can view booking history and track live jobs",
                "Admin console: dispatch, quotes, slots, payments, reports",
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
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Customers who book via WhatsApp can also sign into the PWA — their full history is preserved automatically.
        </p>
      </div>
    </section>
  );
}
