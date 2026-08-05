import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  SPARK_ON_DEMAND,
  SPARK_TOP_UPS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";
import styles from "./PricingPage.module.css";

export function PricingPage() {
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Usage-based pricing</p>
        <h1>Only pay for what you use.</h1>
        <p className={styles.intro}>
          Sparks power Vorinthex. Choose a monthly reserve, add more when you
          need them, and keep your usage in your control.
        </p>
        <div className={styles.freeNotice}>
          <span>New here?</span>
          <strong>{formatSparkCount(NEWCOMER_FREE_SPARKS)} free Sparks</strong>
          <p>Every newcomer starts with Sparks on us.</p>
        </div>
      </section>

      <section className={styles.plans} aria-labelledby="monthly-plans">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Monthly plans</p>
          <h2 id="monthly-plans">Monthly Sparks.</h2>
          <p>Your plan refills your Spark balance every month. Spend them anywhere.</p>
        </div>
        <div className={styles.planGrid}>
          {SPARK_MONTHLY_PLANS.map((plan, index) => (
            <article
              className={`${styles.planCard} ${index === 1 ? styles.featured : ""}`}
              key={plan.name}
            >
              {index === 1 && <span className={styles.planTag}>Most popular</span>}
              <p className={styles.planIndex}>0{index + 1}</p>
              <h3>{plan.name}</h3>
              <p className={styles.planPrice}>
                <strong>{formatUsd(plan.price)}</strong>
                <span>/ month</span>
              </p>
              <div className={styles.sparkAmount}>
                <strong>{formatSparkCount(plan.sparks)}</strong>
                <span>monthly Sparks</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.topUps} aria-labelledby="top-ups">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>More when you need it</p>
          <h2 id="top-ups">Top up your Sparks.</h2>
          <p>One-time Spark packs for a bigger idea or a busier month.</p>
        </div>
        <div className={styles.topUpGrid}>
          {SPARK_TOP_UPS.map((topUp) => (
            <article className={styles.topUpCard} key={topUp.sparks}>
              <div>
                <strong>{formatSparkCount(topUp.sparks)}</strong>
                <span>Sparks</span>
              </div>
              <p>{formatUsd(topUp.price)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.onDemand} aria-labelledby="on-demand">
        <div className={styles.onDemandMark}>∞</div>
        <div className={styles.onDemandCopy}>
          <p className={styles.eyebrow}>For uninterrupted momentum</p>
          <h2 id="on-demand">{SPARK_ON_DEMAND.name}</h2>
          <p>
            On-Demand Sparks are added on top of your monthly plan when your
            included balance runs out. Requires the {SPARK_ON_DEMAND.requiresPlan} plan.
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
