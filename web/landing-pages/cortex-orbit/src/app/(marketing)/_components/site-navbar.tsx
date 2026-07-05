"use client";

import { AnimatePresence, motion, useScroll, useMotionValueEvent } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { SpinningLogo } from "./spinning-logo";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#intelligences", label: "Intelligences" },
  { href: "#use-cases", label: "Use Cases" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About" },
];

export function SiteNavbar({ onJoinWaitlist }: { onJoinWaitlist: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 12);
  });

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <motion.div
        animate={{
          backgroundColor: scrolled
            ? "rgba(9, 9, 11, 0.72)"
            : "rgba(9, 9, 11, 0)",
          borderColor: scrolled
            ? "rgba(255, 255, 255, 0.08)"
            : "rgba(255, 255, 255, 0)",
        }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="border-b backdrop-blur-xl"
      >
        <div className="cui-container flex h-20 items-center justify-between">
          <Link
            href="#top"
            className="flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <SpinningLogo size={26} />
            <span className="text-sm font-medium tracking-[0.16em] text-foreground uppercase">
              Cortex Orbit
            </span>
          </Link>

          <nav className="hidden items-center gap-9 lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-sm text-sm text-foreground-secondary transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center lg:flex">
            <motion.button
              type="button"
              onClick={onJoinWaitlist}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-button bg-accent px-5 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Join Waitlist for Free
              <span aria-hidden="true">→</span>
            </motion.button>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <MenuGlyph open={menuOpen} />
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="border-b border-border bg-background/95 backdrop-blur-xl lg:hidden"
          >
            <nav className="cui-container flex flex-col gap-1 py-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-2 py-2.5 text-sm text-foreground-secondary hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {link.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onJoinWaitlist();
                }}
                className="mt-2 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-button bg-accent text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Join Waitlist for Free
                <span aria-hidden="true">→</span>
              </button>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <motion.line
        x1="2" x2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
        animate={{ y1: open ? 8 : 4, y2: open ? 8 : 4, rotate: open ? 45 : 0 }}
        style={{ originX: "8px", originY: "8px" }}
        transition={{ duration: 0.2 }}
      />
      <motion.line
        x1="2" x2="14" y1="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
        animate={{ opacity: open ? 0 : 1 }}
        transition={{ duration: 0.15 }}
      />
      <motion.line
        x1="2" x2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
        animate={{ y1: open ? 8 : 12, y2: open ? 8 : 12, rotate: open ? -45 : 0 }}
        style={{ originX: "8px", originY: "8px" }}
        transition={{ duration: 0.2 }}
      />
    </svg>
  );
}
