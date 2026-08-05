import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import styles from "./SiteChrome.module.css";

export function Brand() {
  return (
    <Link className={styles.brand} href="/" aria-label="Vorinthex home">
      <Image
        alt=""
        className={styles.brandMark}
        height={42}
        src="/logos/vorinthex-mark.png"
        width={42}
      />
      <span>Vorinthex</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Brand />
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link href="/">Overview</Link>
        <Link href="/#capabilities">Core</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/about">About</Link>
      </nav>
      <Button asChild size="sm" variant="outline">
        <Link href="/#download">Get the app</Link>
      </Button>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Brand />
      <div className={styles.footerLinks}>
        <Link href="/pricing">Pricing</Link>
        <Link href="/about">About</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </div>
      <p>© 2026 Vorinthex. All rights reserved.</p>
    </footer>
  );
}
