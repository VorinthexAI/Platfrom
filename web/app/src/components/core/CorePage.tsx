import Image from "next/image";
import { Button } from "@vorinthex/shared/ui/components";
import { BrainIcon, LockIcon, StarIcon } from "@vorinthex/shared/ui/icons";
import {
  APP_STORE_URL,
  CORE_CAPABILITIES,
  GOOGLE_PLAY_URL,
} from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { CoreNeuralScene } from "./CoreNeuralScene";
import styles from "./CorePage.module.css";

function StoreButtons({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.storeButtons} id={compact ? undefined : "download"}>
      <Button asChild size={compact ? "sm" : "lg"} variant="outline">
        <a href={GOOGLE_PLAY_URL} rel="noreferrer" target="_blank">
          Get it on Google Play
        </a>
      </Button>
      <Button asChild size={compact ? "sm" : "lg"} variant="outline">
        <a href={APP_STORE_URL} rel="noreferrer" target="_blank">
          Download on the App Store
        </a>
      </Button>
    </div>
  );
}

export function CorePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />

      <section className={styles.hero} id="overview">
        <div className={styles.heroCopy}>
          <h1>Your personal AI.</h1>
          <p className={styles.heroLead}>Everything. Intelligently connected.</p>
          <div className={styles.rule} />
          <p className={styles.heroBody}>
            Vorinthex Core is your personal AI that remembers, understands and
            connects everything that matters to you.
          </p>
          <StoreButtons />
        </div>

        <div className={styles.coreVisual} aria-label="Vorinthex Core">
          <CoreNeuralScene />
          <div className={styles.coreLabel}>
            <span>Core</span>
            <strong>Your personal AI</strong>
            <p>The intelligence that connects everything into one.</p>
          </div>
        </div>
      </section>

      <section className={styles.capabilities} id="capabilities">
        <div className={styles.sectionHeading}>
          <span />
          <h2>Core Apps</h2>
          <span />
        </div>
        <div className={styles.capabilityGrid}>
          {CORE_CAPABILITIES.map((capability) => (
            <article className={styles.capabilityCard} key={capability.name}>
              <Image
                alt={`${capability.name} icon`}
                height={160}
                src={capability.icon}
                width={160}
              />
              <h3>{capability.name}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.comingSoon} aria-label="More Core apps coming soon">
        <Image alt="" height={34} src="/logos/vorinthex-mark.png" width={34} />
        <p>More coming soon</p>
      </section>

      <section className={styles.principles} id="principles">
        <div className={styles.principlesCopy}>
          <h2>One AI. Every capability. Always with you.</h2>
          <div className={styles.rule} />
          <div className={styles.principleGrid}>
            <article>
              <BrainIcon aria-hidden size="lg" />
              <h3>One intelligence</h3>
              <p>All your data, conversations, images and knowledge in one place.</p>
            </article>
            <article>
              <LockIcon aria-hidden size="lg" />
              <h3>Private by design</h3>
              <p>Your data is yours. End-to-end encryption and full control.</p>
            </article>
            <article>
              <StarIcon aria-hidden size="lg" />
              <h3>Built for you</h3>
              <p>Contextual, proactive and personal. Built to amplify your potential.</p>
            </article>
          </div>
        </div>

        <div className={styles.phone} aria-label="Core mobile app preview">
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

      <SiteFooter />
    </main>
  );
}
