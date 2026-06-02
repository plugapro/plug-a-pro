import { reviewModelContent } from "@/content/marketing/reviews";

export function SocialProof() {
  return (
    <section className="border-t border-border/40 px-4 py-16">
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Reviews
        </p>
        <h2 className="mb-4 text-3xl font-bold">{reviewModelContent.title}</h2>
        <p className="text-muted-foreground">{reviewModelContent.intro}</p>
      </div>
    </section>
  );
}
