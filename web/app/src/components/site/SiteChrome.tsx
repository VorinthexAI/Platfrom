import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import styles from "./SiteChrome.module.css";

export function Brand() {
  return (
    <Link className={styles.brand} href="/" aria-label="Vorinthex AI home">
      <Image
        alt=""
        className={styles.brandMark}
        height={42}
        src="/logos/vorinthex-mark.png"
        width={42}
      />
      <span>Vorinthex AI</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <Brand />
        <nav className={styles.nav} aria-label="Primary navigation">
          <Link href="/">Overview</Link>
          <Link href="/#core-apps">Core Apps</Link>
          <Link href="/#principles">Vision</Link>
        </nav>
        <Button asChild size="sm" variant="outline">
          <Link href="/">Get the app</Link>
        </Button>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Brand />
      <nav className={styles.footerLinks} aria-label="Footer navigation">
        <Link href="/pricing">Pricing</Link>
        <Link href="/about">About</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </nav>
      <p>© 2026 Vorinthex AI. All rights reserved.</p>
    </footer>
  );
}
