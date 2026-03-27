export function ProblemStatement() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
              The problem
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
              WhatsApp groups and spreadsheets don&apos;t run a service business
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Managing field technicians over shared WhatsApp groups, spreadsheets, and phone calls doesn&apos;t scale. Jobs get lost. Customers go quiet. You have no visibility into what&apos;s happening on-site.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              When something goes wrong — a no-show, a disputed invoice, an extra job that wasn&apos;t approved — you have no audit trail and no recourse.
            </p>
          </div>
          <div className="space-y-4">
            {[
              { icon: "📋", label: "Jobs logged in WhatsApp groups", problem: "No structure, no visibility" },
              { icon: "📞", label: "Dispatch done over the phone", problem: "Slow, error-prone, undocumented" },
              { icon: "🗂️", label: "Invoicing done manually in Excel", problem: "Delayed, inconsistent, hard to track" },
              { icon: "📍", label: "No live technician location or status", problem: "Customers call to ask — repeatedly" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-start gap-4 rounded-xl border border-border/40 p-4"
              >
                <span className="text-2xl" aria-hidden="true">{item.icon}</span>
                <div>
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.problem}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
