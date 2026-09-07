import type { Metadata } from "next";
import { Button } from "@vorinthex/shared/ui/components";
import Link from "next/link";

import { DownloadAppCta } from "@/components/core/DownloadAppCta";
import styles from "@/components/private/PrivateFallback.module.css";
import { PRIVATE_ROUTE_METADATA } from "@/lib/private-route-metadata";

export const metadata: Metadata = { title: "Continue in the app", ...PRIVATE_ROUTE_METADATA };

export default function SignalReturnFallback() {
  return <main className={styles.page}><section className={styles.card}>
    <p className={styles.eyebrow}>Secure connection return</p><h1>Finish in Vorinthex.</h1><p className={styles.copy}>Open the mobile app to finish connecting your email capability. If the connection already completed, return to your workspace.</p>
    <div className={styles.actions}><Button asChild size="lg" variant="primary"><a href="vorinthexcore://capability/signal">Open app</a></Button><Button asChild size="lg" variant="secondary"><Link href="/">Return home</Link></Button><DownloadAppCta /></div>
  </section></main>;
}
