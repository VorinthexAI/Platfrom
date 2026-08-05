import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { CORE_CAPABILITIES } from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import styles from "./PricingPage.module.css";

export function PricingPage() {
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Core pricing</p>
        <h1>Start with one intelligence.</h1>
        <p>
          Core is your free personal AI foundation. Add only the capabilities
          that matter to you, and let every one work from the same context.
        </p>
      </section>

      <section className={styles.foundation}>
        <div className={styles.foundationLogo}>
          <Image
            alt="Vorinthex Core emblem"
            height={220}
            src="/logos/entities/product-core.png"
            width={220}
          />
        </div>
        <div>
          <p className={styles.eyebrow}>Included foundation</p>
          <h2>Vorinthex Core</h2>
          <p className={styles.foundationCopy}>
            One private intelligence that connects your capabilities and grows
            more useful as it understands your context.
          </p>
        </div>
        <div className={styles.foundationPrice}>
          <strong>$0</strong>
          <span>Core foundation</span>
        </div>
      </section>

      <section className={styles.capabilities} aria-labelledby="capability-pricing">
        <div className={styles.sectionHeading}>
          <span />
          <h2 id="capability-pricing">Choose your capabilities</h2>
          <span />
        </div>
        <div className={styles.pricingGrid}>
          {CORE_CAPABILITIES.map((capability) => (
            <article className={styles.pricingCard} key={capability.name}>
              <Image
                alt={`${capability.name} emblem`}
                height={150}
                src={capability.icon}
                width={150}
              />
              <h3>{capability.name}</h3>
              <p className={styles.price}>
                <strong>${capability.price.toFixed(2)}</strong>
                <span>/ month</span>
              </p>
              <p className={styles.description}>{capability.description}</p>
              <ul>
                {capability.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.closing}>
        <Image
          alt=""
          height={72}
          src="/logos/vorinthex-mark.png"
          width={72}
        />
        <p className={styles.eyebrow}>One context across everything</p>
        <h2>Build the Core that fits you.</h2>
        <p>
          Start with your personal AI, then expand it when a capability becomes
          useful. Your context stays connected as Core grows.
        </p>
        <Button asChild size="lg" variant="outline">
          <Link href="/#download">Download Core</Link>
        </Button>
      </section>

      <SiteFooter />
    </main>
  );
}
