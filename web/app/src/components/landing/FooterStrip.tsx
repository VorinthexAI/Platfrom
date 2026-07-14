"use client";

import { syncEntityUrl, useGalaxyStore } from "@/lib/galaxy-store";
import { trackCtaClick } from "@/lib/analytics";

/** The footer vaults, in display order, with their canonical paths. */
const FOOTER_VAULTS = [
  { kind: "about", label: "About", path: "/about" },
  { kind: "pricing", label: "Pricing", path: "/pricing" },
  { kind: "contact", label: "Contact", path: "/contact" },
  { kind: "privacy", label: "Privacy", path: "/privacy" },
  { kind: "terms", label: "Terms", path: "/terms" },
] as const;

/**
 * Slim fixed footer along the bottom edge, mirroring the reference art.
 * About, Contact, Privacy, and Terms open their asteroid vaults instead
 * of flat pages — and the whole strip hides while you're
 * inside any world, so nothing outside the cavern can be clicked.
 */
export function FooterStrip() {
  const mode = useGalaxyStore((s) => s.mode);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const step = useGalaxyStore((s) => s.step);
  const enterCave = useGalaxyStore((s) => s.enterCave);

  const insideWorld =
    mode === "cave" ||
    mode === "jump" ||
    (mode === "system" && step > 0 && visitPhase !== "fly");
  if (insideWorld) return null;

  const openVault = (vault: (typeof FOOTER_VAULTS)[number]) => {
    trackCtaClick("legal_open", { legal_kind: vault.kind });
    enterCave(vault.kind);
    syncEntityUrl(vault.path);
  };

  return (
    <footer className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] z-20">
      <div className="mx-auto flex h-10 w-full max-w-7xl items-center justify-center px-3 lg:h-12 lg:justify-between lg:px-10">
        <p className="hidden font-mono text-[0.58rem] tracking-[0.12em] text-silver-700 lg:block">
          © {new Date().getFullYear()} Vorinthex AI. All rights reserved.
        </p>
        <nav
          aria-label="Company and legal"
          className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-center sm:gap-6 lg:gap-8"
        >
          {FOOTER_VAULTS.map((vault) => (
            <button
              key={vault.kind}
              type="button"
              onClick={() => openVault(vault)}
              className="font-mono text-[0.52rem] tracking-[0.14em] text-silver-500 uppercase transition-colors hover:text-silver-100 sm:text-[0.58rem] sm:tracking-[0.2em] lg:tracking-[0.24em]"
            >
              {vault.label}
            </button>
          ))}
        </nav>
      </div>
    </footer>
  );
}
