import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Button } from "@vorinthex/shared/ui/components";
import { ArrowRightIcon } from "@vorinthex/shared/ui/icons";
import styles from "@/components/private/PrivateFallback.module.css";

const REFERRAL_CODE_PATTERN = /^[0-9A-F]{12}$/;

export const metadata: Metadata = {
  title: "Open referral in Vorinthex Core",
  description: "Open a private Vorinthex referral in the mobile app.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
  },
};

export function isValidReferralCode(code: string) {
  return REFERRAL_CODE_PATTERN.test(code);
}

export default async function ReferralFallbackPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isValidReferralCode(code)) notFound();
  const deepLink = `vorinthexcore://referral/${code}`;

  return (
    <main className={styles.page}>
      <Image aria-hidden alt="" className={styles.mark} height={680} src="/logos/vorinthex-mark.png" width={680} />
      <section className={styles.card}>
        <Image alt="" className={styles.brandMark} height={46} src="/logos/vorinthex-mark.png" width={46} />
        <p className={styles.eyebrow}>A Vorinthex invitation</p>
        <h1>Open this referral in Core.</h1>
        <p className={styles.copy}>Continue in the mobile app to use this referral code when you sign up.</p>
        <ul className={styles.rewards}>
          <li><strong>+50 Sparks</strong><span>Your referrer earns this once when you sign up with their code.</span></li>
          <li><strong>+100 Sparks</strong><span>Your referrer earns this once when you first purchase a subscription.</span></li>
        </ul>
        <div className={styles.actions}>
          <Button asChild size="lg" variant="primary">
            <a href={deepLink}>Open Vorinthex Core <ArrowRightIcon aria-hidden size="sm" /></a>
          </Button>
        </div>
        <p className={styles.note}>Install Vorinthex Core first if the app does not open.</p>
      </section>
    </main>
  );
}
