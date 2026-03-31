import {
  SearchX,
  ShieldOff,
  Hourglass,
  FileWarning,
  TrendingDown,
  Lock,
} from "lucide-react";
import React from "react";

const CUSTOMER_PROBLEMS: { icon: React.ElementType; label: string; problem: string }[] = [
  {
    icon: SearchX,
    label: "No trusted way to find local help",
    problem: "Searching online gives big national companies, not nearby workers",
  },
  {
    icon: ShieldOff,
    label: "No protection when paying strangers",
    problem: "Cash upfront with no record. No recourse if something goes wrong.",
  },
  {
    icon: FileWarning,
    label: "No quote before work starts",
    problem: "Price surprises after the job is done, with nothing in writing",
  },
  {
    icon: Lock,
    label: "Your number shared with strangers",
    problem: "No safe way to communicate without exposing personal contact details",
  },
];

const PROVIDER_PROBLEMS: { icon: React.ElementType; label: string; problem: string }[] = [
  {
    icon: TrendingDown,
    label: "Skilled and available, but no steady work",
    problem: "Sitting outside the hardware store hoping someone walks past",
  },
  {
    icon: Hourglass,
    label: "Word-of-mouth is slow and unreliable",
    problem: "Work comes in bursts. Famine and feast with no way to control it.",
  },
  {
    icon: FileWarning,
    label: "No structured way to quote or confirm",
    problem: "Verbal agreements that lead to payment disputes later",
  },
  {
    icon: ShieldOff,
    label: "Hard to build trust with new customers",
    problem: "No reputation, no reviews. Every new job is a cold start.",
  },
];

function ProblemColumn({
  label,
  headline,
  body,
  items,
}: {
  label: string;
  headline: string;
  body: string;
  items: { icon: React.ElementType; label: string; problem: string }[];
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
        {label}
      </p>
      <h2 className="text-2xl md:text-3xl font-bold mb-3 leading-tight">
        {headline}
      </h2>
      <p className="text-muted-foreground leading-relaxed mb-6 text-sm">{body}</p>
      <div className="space-y-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-start gap-4 rounded-xl border border-border/40 p-4"
            >
              <div className="size-9 rounded-lg flex items-center justify-center bg-muted flex-shrink-0">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.problem}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProblemStatement() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            The problem
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            Two sides. Same frustration.
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-10">
          <ProblemColumn
            label="For customers"
            headline="Getting home help shouldn't be this hard"
            body="Finding a trustworthy worker for a small job is harder than it should be, and too risky when you don't know who's coming to your home."
            items={CUSTOMER_PROBLEMS}
          />
          <ProblemColumn
            label="For workers"
            headline="Skills aren't the problem. Access to work is."
            body="Skilled independent workers across South Africa have the ability but lack a safe, structured way to connect with paying customers."
            items={PROVIDER_PROBLEMS}
          />
        </div>
      </div>
    </section>
  );
}
