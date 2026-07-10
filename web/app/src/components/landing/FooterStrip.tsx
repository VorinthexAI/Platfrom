"use client";

import { syncEntityUrl, useGalaxyStore } from "@/lib/galaxy-store";
import { trackCtaClick } from "@/lib/analytics";

/** The footer vaults, in display order, with their canonical paths. */
const FOOTER_VAULTS = [
  { kind: "about", label: "About", path: "/about" },
  { kind: "contact", label: "Contact", path: "/contact" },
  { kind: "privacy", label: "Privacy", path: "/privacy" },
  { kind: "terms", label: "Terms", path: "/terms" },
] as const;

/**
 * Slim fixed footer along the bottom edge, mirroring the reference art.
 * Desktop only. About, Contact, Privacy, and Terms open their asteroid
 * vaults instead of flat pages — and the whole strip hides while you're
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
    <footer className="absolute inset-x-0 bottom-0 z-20 hidden lg:block">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between px-10">
        <p className="font-mono text-[0.58rem] tracking-[0.12em] text-silver-700">
          © {new Date().getFullYear()} Vorinthex AI. All rights reserved.
        </p>
        <nav aria-label="Company and legal" className="flex items-center gap-8">
          {FOOTER_VAULTS.map((vault) => (
            <button
              key={vault.kind}
              type="button"
              onClick={() => openVault(vault)}
              className="font-mono text-[0.58rem] tracking-[0.24em] text-silver-500 uppercase transition-colors hover:text-silver-100"
            >
              {vault.label}
            </button>
          ))}
        </nav>
      </div>
    </footer>
  );
}
