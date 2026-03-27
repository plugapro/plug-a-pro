const INDUSTRIES = [
  { icon: "🔧", name: "Plumbing & Drainage", description: "Emergency callouts, pipe repairs, drain clearance" },
  { icon: "⚡", name: "Electrical", description: "Installations, fault-finding, compliance certificates" },
  { icon: "🧹", name: "Cleaning Services", description: "Residential, commercial, post-construction" },
  { icon: "❄️", name: "HVAC & Refrigeration", description: "Installation, servicing, gas compliance" },
  { icon: "🏠", name: "General Home Maintenance", description: "Handyman, painting, tiling, carpentry" },
  { icon: "🔑", name: "Locksmith & Security", description: "Lockouts, installations, access control" },
];

export function WhoItsFor() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Who uses Plug-A-Pro
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built for any business that dispatches technicians
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            If your business sends skilled workers to customer locations, Plug-A-Pro handles the entire job lifecycle.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {INDUSTRIES.map((industry) => (
            <div
              key={industry.name}
              className="rounded-2xl border border-border/40 p-5 space-y-2 hover:shadow-sm transition-shadow"
            >
              <span className="text-2xl" aria-hidden="true">{industry.icon}</span>
              <h3 className="font-semibold text-sm">{industry.name}</h3>
              <p className="text-xs text-muted-foreground">{industry.description}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-8">
          Don&apos;t see your industry? If you dispatch technicians to customer locations,{" "}
          <a
            href="/contact"
            className="underline-offset-2 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            get in touch
          </a>
          .
        </p>
      </div>
    </section>
  );
}
