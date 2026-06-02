import { Home, Wrench } from "lucide-react";

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
            Customers, providers and operations each use the channel that fits the moment: WhatsApp for fast actions, the PWA for richer job detail and admin tools for review and dispatch.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Customers */}
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-10 rounded-lg bg-muted text-foreground">
                <Home className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-bold text-lg">For customers</h3>
                <p className="text-xs text-muted-foreground">Request, approve, track and confirm</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Describe the job on WhatsApp or in the PWA",
                "Add service, location, preferred time, notes and photos",
                "Operations reviews the request and dispatches it to eligible providers",
                "Receive provider handover details after a provider unlocks and accepts",
                "Approve quotes or extra work in writing",
                "Track live status updates through WhatsApp",
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

          {/* Service providers */}
          <div className="rounded-2xl border border-border/40 p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-10 rounded-lg bg-muted text-foreground">
                <Wrench className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-bold text-lg">For service providers</h3>
                <p className="text-xs text-muted-foreground">Apply, unlock, accept and update</p>
              </div>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                "Complete provider onboarding on WhatsApp",
                "Submit skills, service areas, availability and evidence",
                "Get approved for marketplace access before live matching",
                "Check wallet credits and top up when needed",
                "Open a secure lead preview, unlock with credits, then accept or decline",
                "Quote, contact the customer and update job status from your phone",
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
          Operations sits behind both journeys: reviewing applications, managing dispatch, monitoring quotes, checking wallet activity and keeping marketplace access controlled.
        </p>
      </div>
    </section>
  );
}
