import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SiteNeuralBackdrop } from "@/components/site/SiteNeuralBackdrop";
import { Button } from "@vorinthex/shared/ui/components";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PlusIcon,
  UsersIcon,
} from "@vorinthex/shared/ui/icons";
import {
  NEWCOMER_FREE_SPARKS,
  REFERRAL_REWARDS,
  SPARK_SUBSCRIPTIONS,
  SPARK_TOP_UP,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";
import { PRICING_HERO_BODY, PRICING_HERO_HEADING } from "@/lib/discoverability";
import styles from "./PricingPage.module.css";

export function PricingPage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <SiteNeuralBackdrop />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Sparks pricing</p>
          <h1>{PRICING_HERO_HEADING}</h1>
          <p className={styles.intro}>{PRICING_HERO_BODY}</p>
          <div className={styles.freeNotice}>
            <span>Newcomer allocation</span>
            <strong>{formatSparkCount(NEWCOMER_FREE_SPARKS)} Sparks</strong>
            <p>Included when you get started.</p>
          </div>
        </section>

        <section className={styles.plans} aria-labelledby="subscription-plans">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Launch subscriptions</p>
            <h2 id="subscription-plans">Choose your cadence.</h2>
            <p>Included Sparks refresh at the start of each billing period.</p>
          </div>
          <div className={styles.planGrid}>
            {SPARK_SUBSCRIPTIONS.map((plan, index) => (
              <article
                className={`${styles.planCard} ${index === 0 ? styles.featured : ""}`}
                key={plan.name}
              >
                {"badge" in plan && <span className={styles.planTag}>{plan.badge}</span>}
                <div className={styles.planIcon} aria-hidden>
                  {plan.cadence === "month" ? <CalendarIcon size="md" /> : <ClockIcon size="md" />}
                </div>
                <h3>{plan.name}</h3>
                {"referencePrice" in plan && (
                  <p className={styles.referencePrice}>
                    Currently discounted from regular <s>{formatUsd(plan.referencePrice)}</s>
                  </p>
                )}
                <p className={styles.planPrice}>
                  <strong>{formatUsd(plan.price)}</strong>
                  <span>/ {plan.cadence}</span>
                </p>
                <div className={styles.sparkAmount}>
                  <strong>{formatSparkCount(plan.sparks)}</strong>
                  <span>Sparks per billing {plan.cadence}</span>
                </div>
                <Button disabled size="lg" variant="primary">
                  Subscriptions coming soon
                </Button>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.topUps} aria-labelledby="top-ups">
          <div className={styles.topUpCopy}>
            <div className={styles.roundIcon}><PlusIcon aria-hidden size="lg" /></div>
            <p className={styles.eyebrow}>No subscription change</p>
            <h2 id="top-ups">Add a little more.</h2>
            <p>A one-time top-up for the week that grows beyond the plan.</p>
          </div>
          <div className={styles.topUpCard}>
            <span>One-time top-up</span>
            <strong>{formatSparkCount(SPARK_TOP_UP.sparks)} Sparks</strong>
            <p>{formatUsd(SPARK_TOP_UP.price)}</p>
            <Button disabled size="lg" variant="primary">Top-ups coming soon</Button>
          </div>
        </section>

        <section className={styles.referrals} aria-labelledby="referrals">
          <div className={styles.referralIntro}>
            <div className={styles.roundIcon}><UsersIcon aria-hidden size="lg" /></div>
            <p className={styles.eyebrow}>Share the signal</p>
            <h2 id="referrals">Invite someone in. Earn Sparks twice.</h2>
            <p>Share your referral code with someone new to Vorinthex.</p>
          </div>
          <ol className={styles.rewardSteps}>
            <li>
              <span><CheckIcon aria-hidden size="sm" /></span>
              <div><strong>+{formatSparkCount(REFERRAL_REWARDS.signup)} Sparks</strong><p>When a new user signs up with your code.</p></div>
            </li>
            <li>
              <span><CheckIcon aria-hidden size="sm" /></span>
              <div><strong>+{formatSparkCount(REFERRAL_REWARDS.firstSubscriptionPurchase)} Sparks</strong><p>When that referred user first purchases a subscription.</p></div>
            </li>
          </ol>
          <p className={styles.referralTerms}>The referrer earns each reward stage one time per referred user.</p>
        </section>
        <p className={styles.taxDisclaimer}>
          Prepaid Sparks remain available after subscription cancellation, and balances
          never go below zero. Storage is charged hourly from prepaid Sparks. If the
          balance cannot cover storage, no debt or backcharges accrue; new storage
          growth is blocked while existing data remains available for export, deletion,
          and recovery. Adding Sparks restores prospective charging. Stored S3-backed
          data is hard-deleted after 90 consecutive unfunded days. Prices are shown in
          USD and exclude VAT and other local taxes. Polar calculates and adds
          applicable tax at checkout.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
