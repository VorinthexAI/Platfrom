import { DashboardMockup } from "./dashboard-mockup";
import { LayersGlyph, ScaleGlyph, ShieldGlyph, SparkGlyph } from "./feature-icons";
import { Reveal } from "./reveal";

const FEATURES = [
  {
    icon: LayersGlyph,
    title: "Unified Workspace",
    description: "All your intelligences, data and workflows in one beautiful interface.",
  },
  {
    icon: SparkGlyph,
    title: "Powerful Intelligences",
    description: "Specialized AI agents that understand your context and goals.",
  },
  {
    icon: ShieldGlyph,
    title: "Private by Design",
    description: "Your data stays yours. End-to-end encryption and enterprise-grade security.",
  },
  {
    icon: ScaleGlyph,
    title: "Built for Scale",
    description: "From individuals to teams to entire organizations.",
  },
];

export function ProductPreviewSection() {
  return (
    <section id="product" className="py-20 sm:py-28">
      <div className="cui-container grid gap-14 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <Reveal>
          <DashboardMockup />
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="max-w-sm text-3xl leading-tight font-normal text-foreground sm:text-4xl">
            Everything you need. In one orbit.
          </h2>

          <div className="mt-10 flex flex-col gap-7">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-foreground-secondary">
                  <Icon />
                </span>
                <div>
                  <p className="text-base font-medium text-foreground">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
