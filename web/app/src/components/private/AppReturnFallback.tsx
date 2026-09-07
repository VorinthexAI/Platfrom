"use client";

import Image from "next/image";
import { useEffect } from "react";
import { Button } from "@vorinthex/shared/ui/components";
import { ArrowRightIcon } from "@vorinthex/shared/ui/icons";
import styles from "./PrivateFallback.module.css";

type ReturnKind = "success" | "error";

const content = {
  success: {
    eyebrow: "Checkout complete",
    title: "Your Sparks are on their way.",
    copy: "Return to Core to continue. Confirmation may take a moment because the completed payment webhook is authoritative.",
    note: "You can safely return to the app while confirmation finishes.",
  },
  error: {
    eyebrow: "Checkout returned",
    title: "Nothing to worry about.",
    copy: "The checkout did not finish. Return to Core whenever you are ready and start a new checkout to try again.",
    note: "No action is needed unless you would like to retry.",
  },
} as const;

export function appReturnUrl(kind: ReturnKind) {
  return `vorinthexcore://checkout/${kind}`;
}

export function AppReturnFallback({ kind }: { kind: ReturnKind }) {
  const deepLink = appReturnUrl(kind);
  const copy = content[kind];

  useEffect(() => {
    window.location.replace(deepLink);
  }, [deepLink]);

  return (
    <main className={styles.page}>
      <Image aria-hidden alt="" className={styles.mark} height={680} src="/logos/vorinthex-mark.png" width={680} />
      <section className={styles.card}>
        <Image alt="" className={styles.brandMark} height={46} src="/logos/vorinthex-mark.png" width={46} />
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className={styles.copy}>{copy.copy}</p>
        <div className={styles.actions}>
          <Button asChild size="lg" variant="primary">
            <a href={deepLink}>Return to Vorinthex Core <ArrowRightIcon aria-hidden size="sm" /></a>
          </Button>
        </div>
        <p className={styles.note}>{copy.note}</p>
      </section>
    </main>
  );
}
