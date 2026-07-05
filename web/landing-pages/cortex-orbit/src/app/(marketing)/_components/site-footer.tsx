import Link from "next/link";
import type { ReactNode } from "react";

import { PlanetCurve } from "./planet-curve";
import { SpinningLogo } from "./spinning-logo";

const COLUMNS = [
  {
    heading: "Product",
    links: ["Intelligences", "Workflows", "Data", "Memory"],
  },
  {
    heading: "Company",
    links: ["About", "Careers", "Privacy", "Terms"],
  },
  {
    heading: "Resources",
    links: ["Docs", "Blog", "Contact"],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-border py-16">
      <PlanetCurve className="inset-0" scale={0.34} />

      <div className="cui-container relative grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <SpinningLogo size={22} />
            <span className="text-sm font-medium tracking-[0.16em] text-foreground uppercase">
              Cortex Orbit
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted">
            The operating system for your intelligence. Build, connect and
            orbit your AI future.
          </p>
          <div className="mt-6 flex items-center gap-4">
            <SocialLink label="X">
              <path d="M4 4l16 16M20 4 4 20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </SocialLink>
            <SocialLink label="LinkedIn">
              <rect x="4" y="9" width="3" height="10" fill="currentColor" />
              <circle cx="5.5" cy="5.5" r="1.6" fill="currentColor" />
              <path d="M10.5 19V9h3v1.6c.7-1.1 1.9-1.8 3.4-1.8 2.5 0 4.1 1.6 4.1 4.6V19h-3v-5.2c0-1.4-.6-2.3-1.9-2.3-1 0-1.7.7-2 1.4-.1.3-.1.6-.1 1V19h-3.5Z" fill="currentColor" />
            </SocialLink>
            <SocialLink label="YouTube">
              <rect x="3.5" y="6.5" width="17" height="11" rx="3" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 9.7v4.6l4-2.3-4-2.3Z" fill="currentColor" />
            </SocialLink>
          </div>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.heading}>
            <p className="cui-label">{column.heading}</p>
            <ul className="mt-4 flex flex-col gap-3">
              {column.links.map((link) => (
                <li key={link}>
                  <Link
                    href="#"
                    className="rounded-sm text-sm text-foreground-secondary transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {link}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="cui-container relative mt-14 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} Cortex Orbit. All rights reserved.</span>
      </div>
    </footer>
  );
}

function SocialLink({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Link
      href="#"
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground-secondary transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {children}
      </svg>
    </Link>
  );
}
