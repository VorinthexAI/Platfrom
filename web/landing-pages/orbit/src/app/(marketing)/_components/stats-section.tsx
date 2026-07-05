import { Reveal } from "./reveal";

const STATS = [
  { value: "10X", label: "Faster workflows" },
  { value: "99.9%", label: "Uptime guarantee" },
  { value: "Private", label: "By design" },
  { value: "∞", label: "Possibilities" },
];

export function StatsSection() {
  return (
    <section className="pb-20 sm:pb-28">
      <div className="cui-container grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {STATS.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.06} y={16}>
            <div className="rounded-card border border-border bg-secondary px-6 py-9 text-center">
              <p className="text-3xl font-normal text-foreground sm:text-4xl">
                {stat.value}
              </p>
              <p className="mt-2 text-sm text-muted">{stat.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
