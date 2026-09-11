import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@vorinthex/shared/ui/components";
import { ArrowRightIcon } from "@vorinthex/shared/ui/icons";

import { DownloadAppCta } from "@/components/core/DownloadAppCta";
import styles from "@/components/private/PrivateFallback.module.css";
import { PRIVATE_ROUTE_METADATA } from "@/lib/private-route-metadata";

export const metadata: Metadata = {
  title: "Open Vorinthex AI",
  description: "Continue in the Vorinthex AI mobile app.",
  ...PRIVATE_ROUTE_METADATA,
};

export default function OpenAppFallback() {
  return <main className={styles.page}>
    <Image aria-hidden alt="" className={styles.mark} height={680} src="/logos/vorinthex-mark.png" width={680} />
    <section className={styles.card}>
      <Image alt="" className={styles.brandMark} height={46} src="/logos/vorinthex-mark.png" width={46} />
      <p className={styles.eyebrow}>Vorinthex AI</p>
      <h1>Continue in the app.</h1>
      <p className={styles.copy}>Open Vorinthex AI to chat with Core and use your connected apps.</p>
      <div className={styles.actions}>
        <Button asChild size="lg" variant="primary"><a href="vorinthexcore://">Open app <ArrowRightIcon aria-hidden size="sm" /></a></Button>
        <DownloadAppCta />
      </div>
    </section>
  </main>;
}
