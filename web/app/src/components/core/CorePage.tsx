import Image from "next/image";
import { Button } from "@vorinthex/shared/ui/components";
import {
  APP_STORE_URL,
  CORE_CAPABILITIES,
  GOOGLE_PLAY_URL,
} from "@/lib/core";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import styles from "./CorePage.module.css";

function StoreButtons({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.storeButtons} id={compact ? undefined : "download"}>
      <Button asChild size={compact ? "sm" : "lg"} variant="outline">
        <a href={APP_STORE_URL} rel="noreferrer" target="_blank">
          Download on the App Store
        </a>
      </Button>
      <Button asChild size={compact ? "sm" : "lg"} variant="outline">
        <a href={GOOGLE_PLAY_URL} rel="noreferrer" target="_blank">
          Get it on Google Play
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
          <p className={styles.eyebrow}>Your intelligence, connected</p>
          <h1>Your personal AI.</h1>
          <p className={styles.heroLead}>Everything. Intelligently connected.</p>
          <div className={styles.rule} />
          <p className={styles.heroBody}>
            Vorinthex Core remembers, understands, and connects everything that
            matters to you. One private intelligence that grows with you.
          </p>
          <StoreButtons />
        </div>

        <div className={styles.coreVisual} aria-label="Vorinthex Core">
          <div className={styles.orbit} />
          <div className={styles.orbitSecondary} />
          <div className={styles.rays} />
          <div className={styles.coreDisc}>
            <Image
              alt="Vorinthex Core emblem"
              className={styles.coreLogo}
              height={512}
              priority
              src="/logos/entities/product-core.png"
              width={512}
            />
          </div>
          <div className={styles.coreLabel}>
            <span>Core</span>
            <strong>Your personal AI</strong>
          </div>
        </div>
      </section>

      <section className={styles.capabilities} id="capabilities">
        <div className={styles.sectionHeading}>
          <span />
          <h2>Core capabilities</h2>
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

      <section className={styles.principles} id="principles">
        <div className={styles.principlesCopy}>
          <p className={styles.eyebrow}>Built around you</p>
          <h2>One AI. Every capability. Always with you.</h2>
          <div className={styles.rule} />
          <div className={styles.principleGrid}>
            <article>
              <span>01</span>
              <h3>One intelligence</h3>
              <p>Your knowledge, conversations, images, and goals in one place.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Private by design</h3>
              <p>Your data is yours, protected by encryption and clear control.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Built for you</h3>
              <p>Contextual and personal, designed to amplify your potential.</p>
            </article>
          </div>
          <StoreButtons compact />
        </div>

        <div className={styles.phone} aria-label="Core mobile app preview">
          <div className={styles.phoneSpeaker} />
          <div className={styles.phoneScreen}>
            <div className={styles.phoneBrand}>Vorinthex</div>
            <p>Good morning.</p>
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
              <strong>Everything important, in context.</strong>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
