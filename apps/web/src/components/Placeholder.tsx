export function Placeholder({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 pt-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="rounded-xl border border-dashed border-black/15 p-4 text-sm text-rock dark:border-white/15">
        {children}
      </div>
    </section>
  );
}
