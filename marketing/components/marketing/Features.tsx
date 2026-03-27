const FEATURES = [
  { title: "Feature One", description: "A short description of the first key feature." },
  { title: "Feature Two", description: "A short description of the second key feature." },
  { title: "Feature Three", description: "A short description of the third key feature." },
  { title: "Feature Four", description: "A short description of the fourth key feature." },
  { title: "Feature Five", description: "A short description of the fifth key feature." },
  { title: "Feature Six", description: "A short description of the sixth key feature." },
];

export function Features() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">Everything you need</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="space-y-2">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
