import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SiteNeuralBackdrop } from "@/components/site/SiteNeuralBackdrop";
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
    <div className={styles.page}>
      <SiteHeader />
      <SiteNeuralBackdrop />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Sparks pricing</p>
          <h1>Usage-based pricing.</h1>
          <p className={styles.intro}>
            Choose a monthly Spark balance and add more whenever you need it.
          </p>
          <div className={styles.freeNotice}>
            <span>Newcomer allocation</span>
            <strong>{formatSparkCount(NEWCOMER_FREE_SPARKS)} Sparks</strong>
            <p>Included when you get started.</p>
          </div>
        </section>

        <section className={styles.plans} aria-labelledby="monthly-plans">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Monthly options</p>
            <h2 id="monthly-plans">Monthly Sparks.</h2>
            <p>Your Spark balance refreshes each month.</p>
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
              {SPARK_ON_DEMAND.description}. Requires the{" "}
              {SPARK_ON_DEMAND.requiresPlan} plan.
            </p>
          </div>
        </section>
        <p className={styles.taxDisclaimer}>
          Prepaid Sparks remain available after subscription cancellation, and balances
          never go below zero. Storage is charged hourly from prepaid Sparks. If the
          balance cannot cover storage, no debt or backcharges accrue; new storage
          growth is blocked while existing data remains available for export, deletion,
          and recovery. Adding Sparks restores prospective charging. Stored S3-backed
          data is hard-deleted after 90 consecutive unfunded days. Prices are shown in
          USD. Local taxes may be added where required.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
