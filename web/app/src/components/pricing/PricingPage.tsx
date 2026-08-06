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
          <p className={styles.eyebrow}>Planned pricing preview</p>
          <h1>Usage-based pricing is planned.</h1>
          <p className={styles.intro}>
            All amounts are planned USD pricing. Sparks and subscriptions are not
            currently purchasable.
          </p>
          <div className={styles.freeNotice}>
            <span>Planned newcomer allocation</span>
            <strong>{formatSparkCount(NEWCOMER_FREE_SPARKS)} Sparks</strong>
            <p>Planned USD preview. Not purchasable.</p>
          </div>
        </section>

        <section className={styles.plans} aria-labelledby="monthly-plans">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Planned monthly options</p>
            <h2 id="monthly-plans">Monthly Sparks.</h2>
            <p>Planned allocations and USD amounts. No purchases are available.</p>
          </div>
          <div className={styles.planGrid}>
            {SPARK_MONTHLY_PLANS.map((plan, index) => (
              <article
                className={`${styles.planCard} ${index === 1 ? styles.featured : ""}`}
                key={plan.name}
              >
                <span className={styles.planTag}>Planned · not purchasable</span>
                <p className={styles.planIndex}>0{index + 1}</p>
                <h3>{plan.name}</h3>
                <p className={styles.planPrice}>
                  <strong>{formatUsd(plan.price)}</strong>
                  <span>planned / month</span>
                </p>
                <div className={styles.sparkAmount}>
                  <strong>{formatSparkCount(plan.sparks)}</strong>
                  <span>Planned monthly Sparks · not purchasable</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.topUps} aria-labelledby="top-ups">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Planned overflow options</p>
            <h2 id="top-ups">Top up your Sparks.</h2>
            <p>Planned one-time Spark packs in USD. Not currently purchasable.</p>
          </div>
          <div className={styles.topUpGrid}>
            {SPARK_TOP_UPS.map((topUp) => (
              <article className={styles.topUpCard} key={topUp.sparks}>
                <div>
                  <strong>{formatSparkCount(topUp.sparks)}</strong>
                  <span>Planned Sparks · not purchasable</span>
                </div>
                <p>{formatUsd(topUp.price)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.onDemand} aria-labelledby="on-demand">
          <div className={styles.onDemandMark}>∞</div>
          <div className={styles.onDemandCopy}>
            <p className={styles.eyebrow}>Planned overflow</p>
            <h2 id="on-demand">{SPARK_ON_DEMAND.name}</h2>
            <p>
              {SPARK_ON_DEMAND.description}. It is planned to require the{" "}
              {SPARK_ON_DEMAND.requiresPlan} option. It is not currently purchasable,
              and no allowance beyond the planned overflow is specified.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
