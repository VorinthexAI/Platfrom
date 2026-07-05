import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

// Minimal, centered auth chrome using the marketing site's cream/serif
// theme (src/shared/brand/DESIGN_SYSTEM.md, tokens.ts, theme.css) — a
// signed-out user hasn't entered /console yet, so this deliberately does
// NOT use the console's dark "control room" theme (neural-map.md §23).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden px-4 py-16 sm:py-24">
      <div aria-hidden="true" className="vui-grid-field absolute inset-0" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="vui-label">Vorinthex AI</span>
        </div>
        {children}
      </div>
    </div>
  );
}
