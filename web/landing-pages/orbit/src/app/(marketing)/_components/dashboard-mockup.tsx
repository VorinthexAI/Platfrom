const SIDEBAR_LINKS = [
  { label: "Home", active: true },
  { label: "Intelligences", active: false },
  { label: "Workflows", active: false },
  { label: "Data", active: false },
  { label: "Memory", active: false },
  { label: "Settings", active: false },
];

const INTELLIGENCES = [
  { name: "Researcher", description: "Deep research and insight generation" },
  { name: "Writer", description: "Long-form content and messaging" },
  { name: "Analyst", description: "Data analysis and visualization" },
  { name: "Designer", description: "Design systems and visual generation" },
];

const RECENT_ACTIVITY = [
  { title: "Q2 Marketing Strategy", updated: "Updated 2m ago" },
  { title: "Competitor Analysis", updated: "Updated 1h ago" },
  { title: "Brand Positioning", updated: "Updated 3h ago" },
];

export function DashboardMockup() {
  return (
    <div className="cui-card overflow-hidden !p-0" aria-hidden="true">
      <div className="grid grid-cols-[168px_1fr] sm:grid-cols-[192px_1fr]">
        <aside className="hidden flex-col gap-1 border-r border-border p-4 sm:flex">
          <div className="mb-4 flex items-center gap-2 px-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-xs font-medium tracking-wide text-foreground-secondary">
              Orbit
            </span>
          </div>
          {SIDEBAR_LINKS.map((link) => (
            <div
              key={link.label}
              className={`rounded-md px-3 py-2 text-xs ${
                link.active
                  ? "bg-secondary text-foreground"
                  : "text-muted"
              }`}
            >
              {link.label}
            </div>
          ))}
        </aside>

        <div className="p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-normal text-foreground sm:text-xl">
              Good morning, Alex
            </h3>
            <SunGlyph />
          </div>
          <p className="mt-1 text-sm text-muted">What shall we build today?</p>

          <p className="mt-6 text-xs font-medium tracking-[0.08em] text-muted uppercase">
            Active Intelligences
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {INTELLIGENCES.map((entry) => (
              <div
                key={entry.name}
                className="rounded-md border border-border bg-secondary p-3"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-foreground-secondary">
                  {entry.name.charAt(0)}
                </span>
                <p className="mt-2.5 text-xs font-medium text-foreground">
                  {entry.name}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted">
                  {entry.description}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs font-medium tracking-[0.08em] text-muted uppercase">
            Recent Activity
          </p>
          <div className="mt-3 flex flex-col">
            {RECENT_ACTIVITY.map((entry, i) => (
              <div
                key={entry.title}
                className={`flex items-center justify-between py-2.5 text-xs ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span className="text-foreground-secondary">{entry.title}</span>
                <span className="text-muted">{entry.updated}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            tabIndex={-1}
            className="mt-4 inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground-secondary"
          >
            View all
          </button>
        </div>
      </div>
    </div>
  );
}

function SunGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="var(--cui-color-warning)" strokeWidth="1.4" />
      <path
        d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"
        stroke="var(--cui-color-warning)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
