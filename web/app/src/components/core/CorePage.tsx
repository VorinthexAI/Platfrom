import Image from "next/image";
import Link from "next/link";
import { Button } from "@vorinthex/shared/ui/components";
import { BrainIcon, ShieldIcon, StarIcon } from "@vorinthex/shared/ui/icons";
import { CORE_CAPABILITIES, CORE_FAQ } from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { CoreAppsDepthScene } from "./CoreAppsDepthScene";
import { CoreAppsJourney } from "./CoreAppsJourney";
import { CoreNeuralScene } from "./CoreNeuralScene";
import styles from "./CorePage.module.css";

function PreLaunchActions() {
  return (
    <div className={styles.storeButtons}>
      <Button asChild size="lg" variant="primary">
        <Link href="/contact">Contact the team</Link>
      </Button>
      <Button asChild size="lg" variant="secondary">
        <Link href="/pricing">View planned pricing</Link>
      </Button>
    </div>
  );
}

export function CorePage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <div className={styles.neuralBackdrop} aria-hidden="true">
        <CoreNeuralScene />
      </div>

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} id="overview">
          <div className={styles.heroCopy}>
            <h1>Your personal AI.</h1>
            <p className={styles.heroLead}>Everything. Intelligently connected.</p>
            <div className={styles.rule} />
            <p className={styles.heroBody}>
              Vorinthex Core is a personal AI in development for iOS and Android,
              planned to connect the context that matters to you.
            </p>
            <p className={styles.launchStatus}>
              Pre-launch. Downloads and purchases are not currently available.
            </p>
            <PreLaunchActions />
          </div>

          <div className={styles.coreVisual} aria-hidden="true" />
        </section>

        <section className={styles.capabilities} id="capabilities">
          <div className={styles.depthStage} aria-hidden="true">
            <CoreAppsDepthScene />
          </div>
          <div className={styles.appsContent}>
            <div className={styles.sectionHeading}>
              <span />
              <div>
                <p>One intelligence, five connected spaces</p>
                <h2>Core Apps</h2>
              </div>
              <span />
            </div>
            <p className={styles.appsIntroduction}>
              Move through the parts of your life without losing context. Every app
              is planned to add understanding to the same personal AI.
            </p>
            <CoreAppsJourney />
            <div className={styles.comingSoon} aria-label="More Core apps coming soon">
              <Image alt="" height={34} src="/logos/vorinthex-mark.png" width={34} />
              <p>More coming soon</p>
            </div>
          </div>
        </section>

        <section className={styles.principles} id="principles">
          <div className={styles.principlesCopy}>
            <h2>One AI. Every capability. Always with you.</h2>
            <div className={styles.rule} />
            <div className={styles.principleGrid}>
              <article>
                <BrainIcon aria-hidden size="lg" />
                <h3>One intelligence</h3>
                <p>Planned to connect data, conversations, images, and knowledge.</p>
              </article>
              <article>
                <ShieldIcon aria-hidden size="lg" />
                <h3>Private by design</h3>
                <p>Privacy and user control are principles guiding Core&apos;s design.</p>
              </article>
              <article>
                <StarIcon aria-hidden size="lg" />
                <h3>Built for you</h3>
                <p>Planned around personal context, with proactive assistance.</p>
              </article>
            </div>
          </div>

          <div className={styles.phone} aria-hidden="true">
            <div className={styles.phoneSpeaker} />
            <div className={styles.phoneScreen}>
              <div className={styles.phoneBrand}>Vorinthex AI</div>
              <p>Good morning, Oscar.</p>
              <small>How can I help you today?</small>
              <div className={styles.phoneCapabilities}>
                {CORE_CAPABILITIES.map((capability) => (
                  <div key={capability.name}>
                    <Image alt="" height={38} src={capability.icon} width={38} />
                    <span>{capability.name}</span>
                  </div>
                ))}
              </div>
              <div className={styles.phoneInsight}>
                <small>Recent insight</small>
                <strong>Project Nexus Update</strong>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.faq} id="faq" aria-labelledby="faq-heading">
          <div className={styles.sectionHeading}>
            <span />
            <div>
              <p>Pre-launch details</p>
              <h2 id="faq-heading">Frequently Asked Questions</h2>
            </div>
            <span />
          </div>
          <div className={styles.faqGrid}>
            {CORE_FAQ.map(({ question, answer }) => (
              <article key={question}>
                <h3>{question}</h3>
                <p>{answer}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
